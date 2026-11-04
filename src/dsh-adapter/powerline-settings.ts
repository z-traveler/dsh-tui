/** /settings parse of the downstream powerline input HUD's segment order,
 *  spread over its `settingField('statusBar.order')` row in `plugin.ts`. */

import { parseStatusBarOrder } from '../hudLayout.js'
import type { TuiSettingsFieldWrite } from './settings-sections.js'

/** `statusBar.order`: the segment list, stored canonicalized. */
export const statusBarOrderSetting = {
  parse(text: string): TuiSettingsFieldWrite | undefined {
    const order = parseStatusBarOrder(text)
    return order === undefined ? undefined : { kind: 'set', value: order.join(',') }
  },
}
