import { NativeModules, Platform, StatusBar } from 'react-native'
import { Navigation } from 'react-native-navigation'
import commonState from '@/store/common/state'

export const navigationAppearance = (isDark: boolean) => ({
  statusBar: { style: isDark ? 'light' as const : 'dark' as const, visible: true, drawBehind: true },
})

export const applyNavigationAppearance = (isDark: boolean, followSystem = false) => {
  StatusBar.setBarStyle(isDark ? 'light-content' : 'dark-content', false)
  if (Platform.OS != 'ios') return
  const options = navigationAppearance(isDark)
  Navigation.setDefaultOptions(options)
  // Includes already-created controllers underneath the current screen.
  for (const id of new Set(Object.values(commonState.componentIds))) {
    if (id) Navigation.mergeOptions(id, options)
  }
  // Native modal controllers and system window controls follow the same theme.
  if (followSystem) NativeModules.LXWindowAppearance?.setAuto()
  else NativeModules.LXWindowAppearance?.setDark(isDark)
}
