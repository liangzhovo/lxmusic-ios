import { useContext, useEffect, useState } from 'react'
import { Platform } from 'react-native'
import { readableThemeWithAccent } from '@/utils/themeAccent'
import { ThemeContext } from './state'
import settingState from '@/store/setting/state'

// export const useSetting = () => {
//   const [setting, updateSetting] = useState(state.setting)

//   useEffect(() => {
//     const handleUpdate = () => {
//       updateSetting(state.setting)
//     }
//     global.state_event.on('configUpdated', handleUpdate)
//     return () => {
//       global.state_event.off('configUpdated', handleUpdate)
//     }
//   }, [])

//   return setting
// }

// export const useSettingValue = <T extends keyof LX.AppSetting>(key: T): LX.AppSetting[T] => {
//   const [value, update] = useState(state.setting[key])

//   useEffect(() => {
//     const handleUpdate = (keys: Array<keyof LX.AppSetting>) => {
//       if (!keys.includes(key)) return
//       update(state.setting[key])
//     }
//     global.state_event.on('configUpdated', handleUpdate)
//     return () => {
//       global.state_event.off('configUpdated', handleUpdate)
//     }
//   }, [key])

//   return value
// }

const readableThemes = new WeakMap<LX.ActiveTheme, LX.ActiveTheme>()
export const useTheme = () => {
  const theme = useContext(ThemeContext)
  if (Platform.OS != 'ios') return theme
  let result = readableThemes.get(theme)
  if (!result) { result = readableThemeWithAccent(theme); readableThemes.set(theme, result) }
  return result
}

export const useTextShadow = () => {
  const [value, update] = useState(settingState.setting['theme.fontShadow'])

  useEffect(() => {
    const handleUpdate = (keys: Array<keyof LX.AppSetting>, setting: Partial<LX.AppSetting>) => {
      if (!keys.includes('theme.fontShadow')) return
      requestAnimationFrame(() => {
        update(setting['theme.fontShadow']!)
      })
    }
    global.state_event.on('configUpdated', handleUpdate)
    return () => {
      global.state_event.off('configUpdated', handleUpdate)
    }
  }, [])

  return value
}
