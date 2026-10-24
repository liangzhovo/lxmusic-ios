import { memo } from 'react'
import { View } from 'react-native'

// import Title from './components/Title'
import { createStyle } from '@/utils/tools'
import { NAV_SHEAR_NATIVE_IDS } from '@/config/constant'
import PlayInfo from './PlayInfo'
import ControlBtn from './ControlBtn'


export default memo(() => {
  return (
    <View style={styles.container} nativeID={NAV_SHEAR_NATIVE_IDS.playDetail_player}>
      <ControlBtn />
      <PlayInfo />
    </View>
  )
})

const styles = createStyle({
  container: {
    flexShrink: 0,
    flexGrow: 1,
    // 与 left.paddingLeft 对齐（移除旧的 15px 缩进，进度条与图标同一垂直线）
    marginLeft: 0,
    // paddingRight: 15,
    // backgroundColor: 'rgba(0,0,0,0.1)',
  },
})
