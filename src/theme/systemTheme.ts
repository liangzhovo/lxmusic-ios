// Desktop semantics: theme.id = auto selects independent light/dark presets.
// The legacy mobile switch remains readable; old users keep their light theme.
export type ThemeSelection = Pick<LX.AppSetting, 'theme.id' | 'theme.lightId' | 'theme.darkId' | 'common.isAutoTheme'>
export const isAutoTheme = (setting: ThemeSelection) => setting['theme.id'] == 'auto' || setting['common.isAutoTheme']
export const selectSystemTheme = <T extends { id: string, isDark: boolean }>(
  available: readonly T[], setting: ThemeSelection, dark: boolean,
): T => {
  const auto = isAutoTheme(setting)
  const preferred = auto
    ? dark ? setting['theme.darkId'] : setting['theme.id'] != 'auto' ? setting['theme.id'] : setting['theme.lightId']
    : setting['theme.id']
  const selected = available.find(theme => theme.id == preferred && (!auto || theme.isDark == dark))
  const fallback = available.find(theme => theme.id == (auto && dark ? 'black' : 'green'))
    ?? available.find(theme => !auto || theme.isDark == dark)
  if (!selected && !fallback) throw new Error('No compatible theme is available')
  return (selected ?? fallback)!
}
