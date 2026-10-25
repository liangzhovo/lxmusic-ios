import { useRef } from 'react'
import { View } from 'react-native'
import { useSetting } from '@/store/setting/hook'
import { useTheme } from '@/store/theme/hook'
import { isSoundEffectActive } from '@/plugins/player/soundEffect'
import SettingPopup, { type SettingPopupType } from '../../components/SettingPopup'
import SoundEffectPopup, { type SoundEffectPopupType } from '../../components/SoundEffectPopup'
import CommentBtn from './CommentBtn'
import Btn from './Btn'
import MusicAddBtn from '../MoreBtn/MusicAddBtn'
import TimeoutExitBtn from '../MoreBtn/TimeoutExitBtn'
import { createStyle } from '@/utils/tools'

export default () => {
  const popupRef = useRef<SettingPopupType>(null)
  const soundEffectPopupRef = useRef<SoundEffectPopupType>(null)
  const setting = useSetting()
  const theme = useTheme()
  return (
    <>
      <View style={styles.container}>
        <View style={styles.slot}><CommentBtn /></View>
        <View style={styles.slot}>
          <Btn icon="slider" color={isSoundEffectActive(setting) ? theme['c-primary-font-active'] : undefined}
            onPress={() => { soundEffectPopupRef.current?.show() }} />
        </View>
        <View style={styles.slot}><MusicAddBtn /></View>
        <View style={styles.slot}><TimeoutExitBtn /></View>
        <View style={styles.slot}><Btn icon="setting" size={18} onPress={() => { popupRef.current?.show() }} /></View>
      </View>
      <SoundEffectPopup ref={soundEffectPopupRef} position="bottom" layoutMode="stacked" />
      <SettingPopup ref={popupRef} position="bottom" direction="horizontal" />
    </>
  )
}

const styles = createStyle({
  container: { flexShrink: 0, flexDirection: 'row', alignItems: 'center', paddingVertical: 2, minHeight: 44 },
  slot: { flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center' },
})
