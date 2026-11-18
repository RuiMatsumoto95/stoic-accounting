import { Font } from '@react-pdf/renderer'
import path from 'path'

let registered = false

export function registerFonts() {
  if (registered) return
  registered = true

  Font.register({
    family: 'NotoSansJP',
    src: path.join(process.cwd(), 'public', 'fonts', 'NotoSansJP-Regular.otf'),
    fontWeight: 'normal',
  })
}
