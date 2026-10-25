export type PanelPosition = 'top' | 'bottom' | 'left' | 'right' | 'center'
export type PanelKind = 'list' | 'panel' | 'player-playlist'
// No global iOS redirect: only the player queue has a left-edge policy.
export const panelPosition = (ios: boolean, kind: PanelKind, requested: PanelPosition): PanelPosition =>
  ios && kind == 'player-playlist' ? 'left' : requested
export const panelBounds = (width: number, height: number, kind: PanelKind) => ({
  width: Math.max(0, Math.min(kind != 'panel' ? 420 : 680, width - 24)),
  height: Math.max(0, Math.min(kind != 'panel' ? 600 : 620, height - 24)),
})
export const listGridLayout = (width: number) => {
  const available = Math.max(0, width - 32)
  const columns = Math.max(1, Math.min(3, Math.floor((available + 12) / 188)))
  return { columns, itemWidth: Math.max(0, (available + 12) / columns) }
}
