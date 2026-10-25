import { memo, useCallback, useEffect, useRef } from 'react'
import { type LayoutChangeEvent, StyleSheet, View, StatusBar, Platform } from 'react-native'
import settingState from '@/store/setting/state'
import { setStatusbarHeight } from '@/core/common'
import { windowSizeTools, getWindowSize } from '@/utils/windowSizeTools'

export default memo(() => {
  const revision = useRef(0)
  const layoutHeight = useRef(0)
  const refreshStatusbar = useCallback(() => {
    if (Platform.OS == 'ios') { setStatusbarHeight(0); return }
    const ticket = ++revision.current
    void getWindowSize().then(size => {
      if (ticket != revision.current) return
      setStatusbarHeight(!settingState.setting['common.alwaysKeepStatusbarHeight'] && size.height >= layoutHeight.current
        ? 0 : StatusBar.currentHeight ?? 0)
    }).catch(() => {})
  }, [])
  const handleLayout = useCallback(({ nativeEvent: { layout } }: LayoutChangeEvent) => {
    layoutHeight.current = layout.height
    // Every layout is authoritative. The previous Dimensions-event gate could
    // drop the final full-screen layout and leave the small-window metrics stuck.
    windowSizeTools.setWindowSize(layout.width, layout.height)
    refreshStatusbar()
  }, [refreshStatusbar])
  useEffect(() => {
    const changed = (keys: Array<keyof LX.AppSetting>) => {
      if (keys.includes('common.alwaysKeepStatusbarHeight')) refreshStatusbar()
    }
    global.state_event.on('configUpdated', changed)
    return () => { revision.current++; global.state_event.off('configUpdated', changed) }
  }, [refreshStatusbar])
  return <View pointerEvents="none" accessible={false} style={StyleSheet.absoluteFill} onLayout={handleLayout} />
})
