// Multi-selection alone uses the upstream theme's existing selection surface.
// Navigation, headings and the playing song must not receive this background.
type Theme = { isDark?: boolean } & Partial<Record<'c-primary-background-hover' | 'c-font' | 'c-primary-font' | 'c-border-background', string>>
export const selectionColors = (theme: Theme) => ({
  background: theme['c-primary-background-hover'] || 'transparent',
  text: theme['c-font'] || (theme.isDark ? '#dddddd' : '#333333'),
  indicator: theme['c-primary-font'] || theme['c-font'] || '#808080',
  border: theme['c-border-background'] || 'transparent',
})
