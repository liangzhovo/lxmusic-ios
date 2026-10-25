import { useEffect, useRef, useState } from 'react'
import { View, TouchableOpacity } from 'react-native'
import { useTheme } from '@/store/theme/hook'
import Text from '@/components/common/Text'
import { useSettingValue } from '@/store/setting/hook'
import Slider from '@/components/common/Slider'
import { updateSetting } from '@/core/common'
import { useI18n } from '@/lang'
import styles from './style'
import { setVolume } from '@/plugins/player'
import { VolumeInteraction } from '@/plugins/player/volumeInteraction'
import { markTimeoutExitInteraction } from '@/core/player/timeoutExit'
import { toast } from '@/utils/tools'

export default () => {
  const theme = useTheme()
  const saved = useSettingValue('player.volume')
  const volume = Math.round(saved * 100)
  const [preview, setPreview] = useState<number | null>(null)
  const gesture = useRef(new VolumeInteraction()).current
  const desired = useRef(saved)
  const t = useI18n()
  const apply = (value: number) => { void setVolume(value).catch(() => toast('音量设置失败，请重试')) }
  useEffect(() => {
    desired.current = saved
    // Reconcile a stale native gain when opening the panel, using the saved
    // preference rather than silently turning up the user's volume.
    apply(saved)
  }, [saved])
  useEffect(() => () => { if (gesture.cancel()) void setVolume(desired.current).catch(() => {}) }, [gesture])
  const commit = (value: number) => {
    desired.current = value
    setPreview(null)
    markTimeoutExitInteraction()
    apply(value)
    updateSetting({ 'player.volume': value })
  }
  return <View style={styles.container}>
    <Text>{t('play_detail_setting_volume')} · {preview ?? volume}%</Text>
    <View style={[styles.content, { width: '100%' }]}>
      <Slider minimumValue={0} maximumValue={100} step={1} value={volume}
        onSlidingStart={() => gesture.start()}
        onValueChange={value => {
          const next = gesture.change(value)
          if (next == null) return
          setPreview(Math.round(next * 100)); markTimeoutExitInteraction(); apply(next)
        }}
        onSlidingComplete={value => {
          const next = gesture.finish(value)
          if (next != null) commit(next)
        }} />
    </View>
    <TouchableOpacity accessibilityRole="button" onPress={() => commit(1)}
      style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 6, backgroundColor: theme['c-button-background'] }}>
      <Text size={13} color={theme['c-button-font']}>恢复应用音量 100%</Text>
    </TouchableOpacity>
  </View>
}
