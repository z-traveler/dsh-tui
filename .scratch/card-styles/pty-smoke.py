"""Isolated demo PTY startup/keyboard/resize/exit smoke; not human visual acceptance.
Run from the feature worktree: python3 .scratch/card-styles/pty-smoke.py
Raw terminal captures stay in /tmp, not in the repository.
"""
import errno
import fcntl
import json
import os
import pty
import select
import signal
import struct
import subprocess
import tempfile
import termios
import time
from pathlib import Path

root = Path(__file__).resolve().parents[2]
captures = Path(tempfile.mkdtemp(prefix='card-styles-pty-'))
results = []
for inline in (False, True):
    for width in (40, 30):
        master, slave = pty.openpty()
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 30, width, 0, 0))
        env = {key: os.environ[key] for key in ('PATH', 'LANG') if key in os.environ}
        env.update(TERM='xterm-256color', FORCE_COLOR='2', DSH_TUI_LANG='zh')
        args = ['node', '--import', 'tsx/esm', 'scripts/downstream/card-styles-demo.tsx']
        if inline:
            args.append('--inline')
        if inline and width == 30:
            args += ['--settings', '.scratch/card-styles/settings.example.json']
        proc = subprocess.Popen(args, cwd=root, env=env, stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
        os.close(slave)
        output = bytearray()
        background_reply = {'sent': False}

        def drain(seconds):
            end = time.monotonic() + seconds
            while time.monotonic() < end:
                ready, _, _ = select.select([master], [], [], min(0.1, max(0, end-time.monotonic())))
                if ready:
                    try:
                        chunk = os.read(master, 65536)
                    except OSError as error:
                        if error.errno == errno.EIO:
                            return
                        raise
                    if not chunk:
                        return
                    output.extend(chunk)
                    if inline and width == 30 and not background_reply['sent'] and b'\x1b]11;?' in output:
                        os.write(master, b'\x1b]11;rgb:ffff/ffff/ffff\x1b\\')
                        background_reply['sent'] = True

        try:
            # Bounded real-terminal observation windows, not regression polling sleeps.
            drain(3)
            for key in (b'\x1b1', b'\x1b2', b'\x1b3', b'\x1bo', b'\x1b[5~', b'\x1b[6~'):
                os.write(master, key)
                drain(0.3)
            fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH', 26, width + 4, 0, 0))
            os.kill(proc.pid, signal.SIGWINCH)
            drain(0.4)
            os.write(master, b'\x03')
            drain(1)
            code = proc.wait(timeout=5)
        finally:
            if proc.poll() is None:
                proc.terminate()
                proc.wait(timeout=5)
            os.close(master)
        label = ('inline' if inline else 'fullscreen') + '-' + str(width)
        (captures / (label + '.ansi')).write_bytes(output)
        decoded = output.decode('utf-8', errors='replace')
        entry = dict(mode=label, exit=code, bytes=len(output),
                     saw_demo='cards:' in decoded,
                     saw_legacy='legacy' in decoded,
                     saw_pi_like='pi-like' in decoded,
                     saw_border_preset='描边' in decoded,
                     file_config_loaded=not (inline and width == 30) or '文件配置' in decoded,
                     light_background_replied=not (inline and width == 30) or background_reply['sent'],
                     alternate_screen_restored=inline or b'\x1b[?1049l' in output,
                     no_exception='Error:' not in decoded and 'TypeError' not in decoded)
        results.append(entry)
        print(json.dumps(entry, ensure_ascii=False))
summary = dict(captures=str(captures), cases=results)
(captures / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2))
assert all(item['exit'] == 0 and item['saw_demo'] and item['saw_legacy'] and item['saw_pi_like'] and item['saw_border_preset'] and item['file_config_loaded'] and item['light_background_replied'] and item['alternate_screen_restored'] and item['no_exception'] for item in results), summary
print('PTY smoke: 4/4 passed; captures:', captures)
