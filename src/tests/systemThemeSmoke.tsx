import React, { useEffect, useRef } from 'react'
import { NativeModules, Platform, ScrollView } from 'react-native'
import { Navigation } from 'react-native-navigation'
import initTheme from '@/core/init/theme'
import { initSetting, updateSetting } from '@/core/common'
import { setAutoTheme, setTheme, setThemeVariant } from '@/core/theme'
import settingState from '@/store/setting/state'
import themeState from '@/store/theme/state'
import { createI18n } from '@/lang'
import { Provider } from '@/store/Provider'
import PageContent from '@/components/PageContent'
import ThemeSettings from '@/screens/Home/Views/Setting/settings/Theme'
import { AutoThemeDialog } from '@/screens/Home/Views/Setting/settings/Theme/AutoTheme'
import type { DialogType } from '@/components/common/Dialog'
import { windowSizeTools } from '@/utils/windowSizeTools'
import { getIsSupportedAutoTheme, getAppearance } from '@/utils/tools'

const support = NativeModules.LXPlaybackTestSupport
const sleep = async(ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const Review = () => {
  const ref = useRef<DialogType>(null)
  useEffect(() => { const timer = setTimeout(() => ref.current?.setVisible(true), 300); return () => clearTimeout(timer) }, [])
  return <PageContent><ScrollView contentContainerStyle={{ padding: 16 }}><ThemeSettings /></ScrollView><AutoThemeDialog ref={ref} /></PageContent>
}
export const runSystemThemeSmoke = async(restart: boolean) => {
  const phase = restart ? 'system-theme-restart' : 'system-theme'
  let cleanup: (() => void) | undefined
  const checks: string[] = []
  const requireCondition = (condition: boolean, message: string) => { if (!condition) throw new Error(message) }
  const record = async(stage: string, done = false, error?: unknown) => support.record({
    phase, stage, done, success: done && !error, error: error ? String(error) : undefined, checks,
    activeTheme: themeState.theme.id, systemDark: themeState.shouldUseDarkColors,
    light: settingState.setting['theme.lightId'], dark: settingState.setting['theme.darkId'],
    mode: settingState.setting['theme.id'],
    osVersion: Platform.Version, autoSupported: getIsSupportedAutoTheme(),
    appearance: getAppearance(), nativeDark: await NativeModules.LXWindowAppearance.getSystemDark(),
  })
  const until = async(test: () => boolean | Promise<boolean>, label: string) => {
    for (let i = 0; i < 100; i++) { if (await test()) { checks.push(label); return }; await sleep(100) }
    throw new Error(label)
  }
  try {
    global.i18n = createI18n('zh_cn')
    await windowSizeTools.init()
    await initSetting()
    if (!restart) updateSetting({ 'theme.id': 'auto', 'common.isAutoTheme': true, 'theme.lightId': 'blue', 'theme.darkId': 'black' })
    requireCondition(getIsSupportedAutoTheme(), `Automatic appearance unsupported on iOS ${String(Platform.Version)}`)
    checks.push('real iOS version gate enables automatic appearance')
    cleanup = await initTheme(settingState.setting)
    Navigation.registerComponent('LXSystemThemeReview', () => () => <Provider><Review /></Provider>)
    await Navigation.setRoot({ root: { component: { name: 'LXSystemThemeReview' } } })
    if (restart) {
      if (settingState.setting['theme.id'] != 'auto' || settingState.setting['theme.lightId'] != 'red' || settingState.setting['theme.darkId'] != 'black') {
        throw new Error('Independent theme presets were not persisted across process restart')
      }
      await until(() => themeState.theme.id == 'black', 'restart retains auto mode and matching dark preset')
      await record('complete', true)
      return
    }
    await until(() => themeState.theme.id == 'blue' && !themeState.shouldUseDarkColors, 'system light selects saved blue')
    await sleep(600)
    // The Python driver changes the simulated OS, not the application palette.
    await record('await-dark')
    await until(() => themeState.shouldUseDarkColors && themeState.theme.id == 'black', 'OS dark event selects saved dark theme')
    await setThemeVariant('red', false)
    await sleep(250)
    requireCondition(themeState.theme.id == 'black', 'Editing inactive light preset changed the dark page')
    checks.push('inactive preset edit preserves current appearance')
    await record('await-light')
    await until(() => !themeState.shouldUseDarkColors && themeState.theme.id == 'red', 'OS light event selects edited light preset')
    setTheme('purple')
    await until(() => themeState.theme.id == 'purple', 'manual theme disables automatic mode')
    await record('await-fixed-dark')
    await until(async() => !!await NativeModules.LXWindowAppearance.getSystemDark(), 'scene reads OS dark despite fixed light window')
    await sleep(300)
    requireCondition(themeState.theme.id == 'purple', 'OS appearance overrode a fixed theme')
    setAutoTheme(true)
    await until(() => themeState.theme.id == 'black', 're-enabling auto clears fixed window override')
    // Allow the existing settings persistence throttle to finish before the
    // driver terminates and launches a genuinely new app process.
    await sleep(600)
    await record('complete', true)
  } catch (error) { await record('failed', true, error) }
  finally { cleanup?.() }
}
