import { memo, useEffect, useState } from 'react'
import { View, ScrollView, AppState, Platform, useWindowDimensions } from 'react-native'
import { screenkeepAwake, screenUnkeepAwake } from '@/utils/nativeModules/utils'
import Header from './components/Header'
import { setComponentId } from '@/core/common'
import { COMPONENT_IDS } from '@/config/constant'
import commonState, { type InitState as CommonState } from '@/store/common/state'
import Pic from './Pic'
import Lyric from './Lyric'
import Player from './Player'
import SongInfo from './components/SongInfo'
import { createStyle } from '@/utils/tools'
import { useStatusbarHeight } from '@/store/common/hook'

export default memo(({ componentId }: { componentId: string }) => {
  const statusBarHeight = useStatusbarHeight()
  const [bodySize, setBodySize] = useState({ width: 0, height: 0 })
  const { fontScale } = useWindowDimensions()
  const leftWidth = Math.min(Math.max(bodySize.width * 0.48, 268), bodySize.width * 0.62)
  const leftHeight = Math.max(bodySize.height, 380 * Math.max(1, fontScale))

  useEffect(() => {
    setComponentId(COMPONENT_IDS.playDetail, componentId)
    screenkeepAwake()
    const appstateListener = AppState.addEventListener('change', (state) => {
      switch (state) {
        case 'active':
          if (!commonState.componentIds.comment) screenkeepAwake()
          break
        case 'background':
          screenUnkeepAwake()
          break
      }
    })
    const handleComponentIdsChange = (ids: CommonState['componentIds']) => {
      if (ids.comment) screenUnkeepAwake()
      else if (AppState.currentState == 'active') screenkeepAwake()
    }
    global.state_event.on('componentIdsUpdated', handleComponentIdsChange)
    return () => {
      global.state_event.off('componentIdsUpdated', handleComponentIdsChange)
      appstateListener.remove()
      screenUnkeepAwake()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // PageContent owns the safe area. Keep controls in the left column so the
  // lyrics can use the entire right column instead of sharing a bottom bar.
  return (
    <View style={[styles.container, { paddingTop: Platform.OS == 'ios' ? 0 : statusBarHeight }]}>
      <Header />
      <View style={styles.body} onLayout={({ nativeEvent: { layout } }) => setBodySize(previous => previous.width == layout.width && previous.height == layout.height ? previous : { width: layout.width, height: layout.height })}>
        <ScrollView style={[styles.left, { width: leftWidth || '48%' }]} contentContainerStyle={{ minHeight: leftHeight }} showsVerticalScrollIndicator={false}>
          <View style={{ height: leftHeight, minWidth: 0 }}>
            <Pic componentId={componentId} />
            <SongInfo />
            <Player />
          </View>
        </ScrollView>
        <View style={styles.right}><Lyric /></View>
      </View>
    </View>
  )
})

const styles = createStyle({
  container: { flex: 1, minWidth: 0, minHeight: 0 },
  body: { flex: 1, minWidth: 0, minHeight: 0, flexDirection: 'row', paddingHorizontal: 12 },
  left: { flexGrow: 0, flexShrink: 0, minWidth: 0, minHeight: 0, paddingRight: 12, paddingBottom: 8 },
  right: { flex: 1, minWidth: 0, minHeight: 0, position: 'relative', overflow: 'hidden' },
})
