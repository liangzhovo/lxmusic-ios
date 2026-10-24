/**
 * 播放详情页 - 屏幕生命周期 hook
 * 职责：注册/注销 componentId、屏幕常亮、前后台与评论页联动。
 * 从 index.tsx 抽出，便于复用与测试（行为不变）。
 */
import { useEffect } from 'react'
import { AppState } from 'react-native'
import { screenkeepAwake, screenUnkeepAwake } from '@/utils/nativeModules/utils'
import { setComponentId } from '@/core/common'
import { COMPONENT_IDS } from '@/config/constant'
import commonState, { type InitState as CommonState } from '@/store/common/state'

export const usePlayDetailScreen = (componentId: string) => {
  useEffect(() => {
    setComponentId(COMPONENT_IDS.playDetail, componentId)
    screenkeepAwake()
    let appstateListener = AppState.addEventListener('change', (state) => {
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
}
