import { StyleSheet, TouchableOpacity, View } from 'react-native'
import { Icon } from '@/components/common/Icon'
import { useTheme } from '@/store/theme/hook'
import { playNext, playPrev, togglePlay } from '@/core/player/player'
import { useIsPlay } from '@/store/player/hook'
import { markTimeoutExitInteraction } from '@/core/player/timeoutExit'
import PlayModeBtn from '../MoreBtn/PlayModeBtn'
import PlaylistBtn from '../components/PlaylistBtn'

export default () => {
  const theme = useTheme()
  const isPlay = useIsPlay()
  return (
    <View style={styles.content}>
      <View style={styles.slot}><PlayModeBtn /></View>
      <View style={styles.slot}>
        <TouchableOpacity style={styles.button} accessibilityRole="button" accessibilityLabel="上一曲" onPress={() => { markTimeoutExitInteraction(); void playPrev() }}>
          <Icon name="prevMusic" color={theme['c-button-font']} rawSize={30} />
        </TouchableOpacity>
      </View>
      <View style={styles.slot}>
        <TouchableOpacity style={styles.button} accessibilityRole="button" accessibilityLabel={isPlay ? '暂停' : '播放'} onPress={() => { markTimeoutExitInteraction(); togglePlay() }}>
          <Icon name={isPlay ? 'pause' : 'play'} color={theme['c-button-font']} rawSize={38} />
        </TouchableOpacity>
      </View>
      <View style={styles.slot}>
        <TouchableOpacity style={styles.button} accessibilityRole="button" accessibilityLabel="下一曲" onPress={() => { markTimeoutExitInteraction(); void playNext() }}>
          <Icon name="nextMusic" color={theme['c-button-font']} rawSize={30} />
        </TouchableOpacity>
      </View>
      <View style={styles.slot}><PlaylistBtn /></View>
    </View>
  )
}

const styles = StyleSheet.create({
  content: { flexShrink: 0, flexDirection: 'row', alignItems: 'center', minHeight: 56 },
  slot: { flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center' },
  button: { width: '100%', maxWidth: 52, height: 52, alignItems: 'center', justifyContent: 'center' },
})
