import { playingColor } from '@/utils/playingColor'
import { selectionColors } from '@/utils/selectionColors'
import { useState } from 'react'
import { View, StyleSheet } from 'react-native'
import Text from './Text'
import { useTheme } from '@/store/theme/hook'
import { useHorizontalMode } from '@/utils/hooks'
import { songColumns, SONG_COLUMN_GAP, SONG_TIME_WIDTH, SONG_TRAILING_GAP } from '@/utils/songLayout'

export interface SongRowProps {
  name: string
  singer: string
  album?: string
  source?: string
  interval?: string | null
  active?: boolean
  selected?: boolean
  surface?: string
  showAlbum?: boolean
  showInterval?: boolean
  header?: boolean
}
export default ({ name, singer, album, source, interval, active = false, selected: isSelected = false, surface, showAlbum = true, showInterval = true, header = false }: SongRowProps) => {
  const theme = useTheme()
  const horizontal = useHorizontalMode()
  const [width, setWidth] = useState(0)
  const columns = songColumns(width, horizontal, showAlbum, showInterval)
  const selected = selectionColors(theme)
  const playing = playingColor(theme, surface)
  const color = active ? playing : isSelected ? selected.text : theme['c-font']
  const secondary = header || active || isSelected ? color : theme['c-font-label']
  const weight = header ? '600' : '400'
  if (header && columns.compact) return null
  const title = <View style={styles.titleRow}>
    <Text size={columns.compact ? 16 : 14} numberOfLines={1} color={color}
      style={{ flexShrink: 1, fontWeight: weight }}>{name}</Text>
    {!header && source ? <Text testID="song-source" size={10} color={active ? playing : isSelected ? selected.text : theme['c-primary-font']}
      accessibilityLabel={`音源 ${source}`} style={styles.source}>{source.toLowerCase()}</Text> : null}
  </View>
  return <View style={styles.row} onLayout={e => setWidth(e.nativeEvent.layout.width)}>
    {columns.compact ? <View style={styles.metadata}>
      {title}
      <Text size={12} numberOfLines={1} color={secondary} style={styles.subtitle}>{singer}</Text>
    </View> : <>
      <View style={[styles.column]}>{title}</View>
      <Text size={13} numberOfLines={1} color={secondary} style={[styles.column, { fontWeight: weight }]}>{singer}</Text>
      {columns.album ? <Text size={13} numberOfLines={1} color={secondary} style={[styles.column, { fontWeight: weight }]}>{album ?? ''}</Text> : null}
    </>}
    {columns.time ? <Text size={13} numberOfLines={1} color={secondary} style={[styles.time, { fontWeight: weight }]}>{interval ?? ''}</Text> : null}
  </View>
}
const styles = StyleSheet.create({
  row: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: SONG_COLUMN_GAP, paddingRight: SONG_TRAILING_GAP },
  column: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'baseline', minWidth: 0 },
  source: { flexShrink: 0, marginLeft: 5 },
  metadata: { flex: 1, minWidth: 0, justifyContent: 'center' },
  subtitle: { paddingTop: 3 },
  time: { width: SONG_TIME_WIDTH, flexShrink: 0, textAlign: 'center', fontVariant: ['tabular-nums'] },
})
