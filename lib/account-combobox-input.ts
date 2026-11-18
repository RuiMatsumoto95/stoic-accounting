type InputKey = {
  key: string
  ctrlKey: boolean
  altKey: boolean
  metaKey: boolean
}

// keyCode 229 は、変換確定時に isComposing が false になるブラウザ向け。
export function isImeInput(event: { isComposing: boolean; keyCode: number }, composing = false): boolean {
  return composing || event.isComposing || event.keyCode === 229
}

export function shouldReplaceAccountOnKey(open: boolean, event: InputKey): boolean {
  return !open && event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey
}
