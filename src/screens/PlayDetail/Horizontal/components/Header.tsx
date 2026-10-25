import { memo } from 'react'
import { StyleSheet, TouchableOpacity, View } from 'react-native'
import { Icon } from '@/components/common/Icon'
import { pop } from '@/navigation'
import { scaleSizeH } from '@/utils/pixelRatio'
import { HEADER_HEIGHT as _HEADER_HEIGHT, NAV_SHEAR_NATIVE_IDS } from '@/config/constant'
import commonState from '@/store/common/state'

export const HEADER_HEIGHT = Math.max(44, scaleSizeH(_HEADER_HEIGHT))

export default memo(() => {
  const back = () => {
    const componentId = commonState.componentIds.playDetail
    if (componentId) void pop(componentId)
  }
  return (
    <View style={styles.container} nativeID={NAV_SHEAR_NATIVE_IDS.playDetail_header}>
      <TouchableOpacity onPress={back} style={styles.button} activeOpacity={0.55} accessibilityRole="button" accessibilityLabel="收起播放器">
        <Icon name="chevron-left" size={18} style={styles.collapseIcon} />
      </TouchableOpacity>
    </View>
  )
})

const styles = StyleSheet.create({
  container: { height: HEADER_HEIGHT, flexShrink: 0, flexDirection: 'row', alignItems: 'center' },
  button: { width: HEADER_HEIGHT, height: HEADER_HEIGHT, justifyContent: 'center', alignItems: 'center' },
  collapseIcon: { transform: [{ rotate: '-90deg' }] },
})
