import { StyleSheet, View } from 'react-native'
import { useTheme } from '@/store/theme/hook'

// Queue/list + play marker, distinct from the repeat/order playback mode glyph.
export default () => {
  const theme = useTheme()
  const color = theme['c-font-label']
  return <View accessible={false} style={styles.box}>
    {[2, 8, 14].map(top => <View key={top} style={[styles.line, { top, width: top == 14 ? 9 : 18, backgroundColor: color }]} />)}
    <View style={[styles.play, { borderLeftColor: color }]} />
  </View>
}
const styles = StyleSheet.create({
  box: { width: 20, height: 20 },
  line: { position: 'absolute', left: 0, height: 2, borderRadius: 1 },
  play: { position: 'absolute', left: 13, top: 12, width: 0, height: 0, borderTopWidth: 4, borderBottomWidth: 4,
    borderLeftWidth: 6, borderTopColor: 'transparent', borderBottomColor: 'transparent' },
})
