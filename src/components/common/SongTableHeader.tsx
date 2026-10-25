import { useHorizontalMode } from '@/utils/hooks'
import { SONG_ACTION_WIDTH, SONG_NUMBER_WIDTH } from '@/utils/songLayout'
import { View } from 'react-native'
import Text from './Text'
import SongRowContent from './SongRowContent'
import { useTheme } from '@/store/theme/hook'

export default ({ showAlbum = true, showInterval = true, numbered = true, actions = true }: {
  showAlbum?: boolean, showInterval?: boolean, numbered?: boolean, actions?: boolean
}) => {
  const theme = useTheme()
  const horizontal = useHorizontalMode()
  if (!horizontal) return null
  return <View testID="song-table-header" accessibilityRole="header" style={{ flexDirection: 'row', alignItems: 'center', minHeight: 46,
    paddingRight: actions ? 2 : 16, paddingLeft: numbered ? 0 : 16, flexShrink: 0,
    borderBottomWidth: 1, borderBottomColor: theme['c-border-background'], backgroundColor: 'transparent' }}>
    {numbered ? <Text size={13} color={theme['c-font-label']} style={{ width: SONG_NUMBER_WIDTH, textAlign: 'center' }}>#</Text> : null}
    <SongRowContent header name="歌曲名" singer="艺术家" album="专辑名" interval="时长" showAlbum={showAlbum} showInterval={showInterval} />
    {actions ? <Text size={12} style={{ width: SONG_ACTION_WIDTH, textAlign: 'center', fontWeight: '600' }}>操作</Text> : null}
  </View>
}
