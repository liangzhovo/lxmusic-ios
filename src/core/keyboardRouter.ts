export type KeyboardAction = 'select_up' | 'select_down' | 'select_enter' | 'locate_current' | 'escape'
type Target = { layer: number, enabled: () => boolean, handle: (action: KeyboardAction) => boolean }
// A layer is a real visible modal, not an arbitrary timeout. Hidden screens and
// underlying lists never receive arrow/Enter actions from another layer.
export class KeyboardRouter {
  private targets: Target[] = []
  private layers: number[] = []
  register(target: Target) { this.targets.push(target); return () => { this.targets = this.targets.filter(t => t !== target) } }
  openLayer(id: number) { this.layers = this.layers.filter(n => n !== id); this.layers.push(id) }
  closeLayer(id: number) { this.layers = this.layers.filter(n => n !== id) }
  dispatch(action: KeyboardAction): boolean {
    const layer = this.layers[this.layers.length - 1] ?? 0
    for (const target of [...this.targets].reverse()) {
      if (target.layer == layer && target.enabled() && target.handle(action)) return true
    }
    return false
  }
  get blocked() { return this.layers.length > 0 }
}
export const keyboardRouter = new KeyboardRouter()
export const nextKeyboardIndex = (current: number, direction: -1 | 1, length: number) => {
  if (length <= 0) return -1
  if (current < 0) return direction > 0 ? 0 : length - 1
  return Math.max(0, Math.min(length - 1, current + direction))
}
