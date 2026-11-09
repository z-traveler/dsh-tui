"""Real demo PTY body/scroll acceptance. Run from the feature worktree.
Uses the installed @xterm/headless only to decode captured terminal bytes.
This is automated terminal evidence, not human visual acceptance.
"""
import errno
import fcntl
import json
import os
import pty
import select
import struct
import subprocess
import tempfile
import termios
import time
from pathlib import Path

root = Path(__file__).resolve().parents[2]
out = root / '.scratch/card-styles/evidence/issue05'
out.mkdir(parents=True, exist_ok=True)
rawdir = Path(tempfile.mkdtemp(prefix='card-styles-issue05-entry-'))
decoder = r"""
import { readFileSync } from 'node:fs'
import xterm from '@xterm/headless'
const { Terminal } = xterm
let raw = readFileSync(process.argv[1], 'utf8')
for (const marker of ['\x1b[?1049l', '\x1b[?1047l']) {
  const index = raw.indexOf(marker)
  if (index >= 0) raw = raw.slice(0, index)
}
const term = new Terminal({ cols: Number(process.argv[2]), rows: 30, scrollback: 0, allowProposedApi: true })
await new Promise(resolve => term.write(raw, resolve))
console.log(Array.from({length: 30}, (_, y) => `${String(y).padStart(2, '0')}|${term.buffer.active.getLine(y)?.translateToString(true) ?? ''}`).join('\n'))
term.dispose()
"""
color = os.environ.get('FORCE_COLOR', '3')
results = []
for inline in (False, True):
    for cols in (30, 80):
        name = ('inline' if inline else 'fullscreen') + '-' + str(cols)
        master, slave = pty.openpty()
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 30, cols, 0, 0))
        env = {key: os.environ[key] for key in ('PATH', 'LANG', 'TMUX', 'COLORTERM') if key in os.environ}
        env.update(TERM='xterm-256color', FORCE_COLOR=color, DSH_TUI_LANG='zh')
        args = ['node', '--import', 'tsx/esm', 'scripts/downstream/card-styles-demo.tsx'] + (['--inline'] if inline else [])
        proc = subprocess.Popen(args, cwd=root, env=env, stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
        os.close(slave)
        data = bytearray()

        def drain(seconds):
            end = time.monotonic() + seconds
            while time.monotonic() < end:
                ready, _, _ = select.select([master], [], [], min(.1, max(0, end-time.monotonic())))
                if ready:
                    try:
                        chunk = os.read(master, 65536)
                    except OSError as error:
                        if error.errno == errno.EIO:
                            return
                        raise
                    if not chunk:
                        return
                    data.extend(chunk)

        def screen(stage):
            file = rawdir / (name + '-' + stage + '.raw')
            file.write_bytes(data)
            text = subprocess.check_output(['node', '--input-type=module', '-e', decoder, str(file), str(cols)], cwd=root, text=True)
            (out / ('actual-' + name + '-' + stage + '.txt')).write_text(text)
            return text

        try:
            # Fixed observation windows for a real terminal probe, not a CI wait primitive.
            drain(2)
            os.write(master, b'\x1b3')
            drain(.5)
            os.write(master, b'g')
            drain(.8)
            top = screen('top')
            assert '把卡片样式接进转录' in top and '无边框' in top, (name, 'top body missing', top)
            for _ in range(2):
                os.write(master, b'\x1b[6~')
                drain(.5)
            drain(.3)
            middle = screen('middle')
            assert any(value in middle for value in ('const a', '42 passed', 'exit code 1', '子代理', 'working', 'pwsh')), (name, 'middle body missing', middle)
            os.write(master, b'G')
            drain(.8)
            bottom = screen('bottom')
            assert 'echo hello' in bottom and any(value in bottom for value in ('摘要', '已打断', 'Interrupted')), (name, 'bottom body missing', bottom)
            os.write(master, b'\x03')
            drain(.5)
            code = proc.wait(timeout=5)
            assert code == 0 and (inline or b'\x1b[?1049l' in data), (name, code)
            near_black = b'\x1b[48;2;14;27;20m' in data
            if color == '3':
                assert near_black, (name, 'near-black RGB preset face missing')
            observed = '\x1b[48;2;14;27;20m' if near_black else None
            result = dict(mode=name, color=color, exit=code, top_body=True, middle_body=True, bottom_body=True, near_black_rgb=near_black, observed_success_sgr=observed, raw=str(rawdir))
            results.append(result)
            print(json.dumps(result, ensure_ascii=False))
        finally:
            if proc.poll() is None:
                proc.terminate()
                proc.wait(timeout=5)
            os.close(master)
(out / 'actual-entry-summary.json').write_text(json.dumps(results, ensure_ascii=False, indent=2))
print('real entry body checks:', len(results), 'passed')
