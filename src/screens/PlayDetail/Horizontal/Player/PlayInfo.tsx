import { View } from 'react-native'
import Progress from '@/components/player/ProgressBar'
import Status from './Status'
import { useProgress } from '@/store/player/hook'
import { useTheme } from '@/store/theme/hook'
import { createStyle } from '@/utils/tools'
import Text from '@/components/common/Text'
import { useBufferProgress } from '@/plugins/player'

export default () => {
  const theme = useTheme()
  const { maxPlayTimeStr, nowPlayTimeStr, progress, maxPlayTime } = useProgress()
  const buffered = useBufferProgress()
  return (
    <View>
      <View style={styles.row}>
        <View style={styles.progress}><Progress progress={progress} duration={maxPlayTime} buffered={buffered} /></View>
        <Text numberOfLines={1} color={theme['c-500']} style={styles.time}>{nowPlayTimeStr} / {maxPlayTimeStr}</Text>
      </View>
      <View style={styles.status}><Status /></View>
    </View>
  )
}

const styles = createStyle({
  row: { minHeight: 32, flexDirection: 'row', alignItems: 'center' },
  progress: { flex: 1, minWidth: 0, marginRight: 16 },
  time: { flexShrink: 0, fontVariant: ['tabular-nums'] },
  status: { minHeight: 18, paddingHorizontal: 2 },
})
