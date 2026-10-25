import themeActions from '@/store/theme/action'
import { getTheme, getAllThemes } from '@/theme/themes'
import { updateSetting } from './common'
import themeState from '@/store/theme/state'
import settingState from '@/store/setting/state'

export const setShouldUseDarkColors = (shouldUseDarkColors: boolean) => {
  themeActions.setShouldUseDarkColors(shouldUseDarkColors)
}
export const applyTheme = (theme: LX.Theme) => { themeActions.setTheme(theme) }
let themeRevision = 0
export const refreshTheme = async() => {
  const revision = ++themeRevision
  const theme = await getTheme()
  if (revision == themeRevision) applyTheme(theme)
}
export const setAutoTheme = (enabled: boolean) => {
  const setting = settingState.setting
  const legacyLight = setting['common.isAutoTheme'] && setting['theme.id'] != 'auto'
    ? setting['theme.id'] : setting['theme.lightId']
  updateSetting(enabled
    ? { 'theme.id': 'auto', 'common.isAutoTheme': true, 'theme.lightId': legacyLight }
    : { 'theme.id': themeState.theme.id, 'common.isAutoTheme': false })
  void refreshTheme().catch(() => {})
}
export const setTheme = (id: string) => {
  if (id == 'auto') return setAutoTheme(true)
  updateSetting({ 'theme.id': id, 'common.isAutoTheme': false })
  void refreshTheme().catch(() => {})
}
export const setThemeVariant = async(id: string, dark: boolean) => {
  const info = await getAllThemes()
  const candidate = [...info.themes, ...info.userThemes].find(theme => theme.id == id)
  if (!candidate || candidate.isDark != dark) throw new Error('Theme does not belong to this appearance group')
  const setting = settingState.setting
  const legacy = setting['common.isAutoTheme'] && setting['theme.id'] != 'auto'
    ? { 'theme.id': 'auto', 'theme.lightId': setting['theme.id'] } : {}
  updateSetting({ ...legacy, ...(dark ? { 'theme.darkId': id } : { 'theme.lightId': id }) })
}
