import { AppState, NativeModules, Platform } from 'react-native'
import { getAppearance, getIsSupportedAutoTheme, onAppearanceChange } from '@/utils/tools'
import { setShouldUseDarkColors, refreshTheme } from '@/core/theme'
import settingState from '@/store/setting/state'
import { applyNavigationAppearance } from '@/navigation/appearance'
import themeState from '@/store/theme/state'
import { isAutoTheme } from '@/theme/systemTheme'

let disposeTheme: (() => void) | undefined
export default async(_setting: LX.AppSetting) => {
  disposeTheme?.()
  let disposed = false
  let appearanceRevision = 0
  const appearance = () => applyNavigationAppearance(themeState.theme.isDark, isAutoTheme(settingState.setting))
  const readSystem = async() => {
    const revision = ++appearanceRevision
    let dark = getAppearance() == 'dark'
    if (Platform.OS == 'ios' && NativeModules.LXWindowAppearance?.getSystemDark) {
      // A fixed light/dark window may override Appearance's reported value.
      // UIWindowScene retains the real system preference independently.
      dark = await NativeModules.LXWindowAppearance.getSystemDark().catch(() => dark)
    }
    if (disposed || revision != appearanceRevision) return
    const changed = themeState.shouldUseDarkColors != dark
    setShouldUseDarkColors(dark)
    if (changed && isAutoTheme(settingState.setting)) await refreshTheme()
  }
  const configUpdated: typeof global.state_event.configUpdated = keys => {
    if (!keys.some(key => ['theme.id', 'theme.lightId', 'theme.darkId', 'common.isAutoTheme', 'theme.hideBgDark'].includes(key))) return
    void readSystem().then(() => { if (!disposed) return refreshTheme() }).catch(() => {})
    appearance()
  }
  const subscription = getIsSupportedAutoTheme()
    ? onAppearanceChange(() => { void readSystem().catch(() => {}) }) : undefined
  const appState = AppState.addEventListener('change', state => {
    if (state == 'active') { appearance(); void readSystem().catch(() => {}) }
  })
  global.state_event.on('configUpdated', configUpdated)
  global.state_event.on('themeUpdated', appearance)
  global.state_event.on('componentIdsUpdated', appearance)
  const cleanup = () => {
    disposed = true
    appearanceRevision++
    subscription?.remove()
    appState.remove()
    global.state_event.off('configUpdated', configUpdated)
    global.state_event.off('themeUpdated', appearance)
    global.state_event.off('componentIdsUpdated', appearance)
  }
  disposeTheme = cleanup
  await readSystem()
  if (!disposed) { await refreshTheme(); appearance() }
  return cleanup
}
