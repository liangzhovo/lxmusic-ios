import { View, TouchableOpacity, Platform } from 'react-native'
import Text from '@/components/common/Text'
import { useTheme } from '@/store/theme/hook'
import { useActiveListId } from '@/store/list/hook'
import { openLibraryPage } from '@/core/library/page'

export default function Toolbar({ onNew }: { onNew: () => void }) {
  const theme = useTheme(), listId = useActiveListId()
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 8, borderBottomWidth: 0.5, borderBottomColor: theme['c-border-background'] }}>
    <TouchableOpacity testID="mylist-create" accessibilityRole="button" accessibilityLabel="新建列表" onPress={onNew} style={{ minHeight: 44, paddingHorizontal: 8, justifyContent: 'center' }}>
      <Text size={14} color={theme['c-primary-font']}>＋ 新建列表</Text>
    </TouchableOpacity>
    {Platform.OS === 'ios' ? <TouchableOpacity testID="mylist-webdav-import" accessibilityRole="button" accessibilityLabel="从WebDAV添加歌曲" onPress={() => { openLibraryPage('webdav', listId || 'default') }} style={{ minHeight: 44, paddingHorizontal: 8, justifyContent: 'center' }}>
      <Text size={14} color={theme['c-button-font']}>从 WebDAV 添加</Text>
    </TouchableOpacity> : null}
  </View>
}
