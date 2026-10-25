/** Keep dark dock and page on the same surface without recolouring light themes. */
export const playerBarBackground = (theme: {
  isDark: boolean
  'c-main-background': string
  'c-content-background': string
}) => theme.isDark ? theme['c-main-background'] : theme['c-content-background']
