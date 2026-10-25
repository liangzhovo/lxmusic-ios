import { memo } from 'react'
import { View } from 'react-native'
import { createStyle } from '@/utils/tools'
import { NAV_SHEAR_NATIVE_IDS } from '@/config/constant'
import PlayInfo from './PlayInfo'
import ControlBtn from './ControlBtn'
import ActionBar from '../components/ActionBar'

export default memo(() => (
  <View style={styles.container} nativeID={NAV_SHEAR_NATIVE_IDS.playDetail_player}>
    <PlayInfo />
    <ControlBtn />
    <ActionBar />
  </View>
))

const styles = createStyle({
  container: { flexShrink: 0, minWidth: 0, paddingHorizontal: 4, paddingTop: 4, paddingBottom: 8 },
})
