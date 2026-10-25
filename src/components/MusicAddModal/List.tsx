import { useState } from 'react'
import { ScrollView, TouchableOpacity, View } from 'react-native'

import Text from '@/components/common/Text'
import { useMyList } from '@/store/list/hook'
import ListItem, { styles as listStyles } from './ListItem'
import CreateUserList from './CreateUserList'
import { listGridLayout } from '@/utils/panelLayout'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import { createStyle } from '@/utils/tools'

const styles = createStyle({
  list: {
    paddingLeft: 16,
    paddingRight: 4,
    paddingBottom: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    // backgroundColor: 'rgba(0,0,0,0.2)'
    // justifyContent: 'center',
  },
})
const EditListItem = ({ itemWidth }: {
  itemWidth: number
}) => {
  const [isEdit, setEdit] = useState(false)
  const theme = useTheme()
  const t = useI18n()

  return (
    <View style={{ ...listStyles.listItem, width: itemWidth }}>
      <TouchableOpacity
        style={{ ...listStyles.button, borderColor: theme['c-primary-font'], borderStyle: 'dashed' }}
        onPress={() => { setEdit(true) }}
      >
        <Text style={{ opacity: isEdit ? 0 : 1 }} numberOfLines={1} size={14} color={theme['c-button-font']}>+  {t('list_create')}</Text>
      </TouchableOpacity>
      {
        isEdit
          ? <CreateUserList isEdit={isEdit} onHide={() => { setEdit(false) }} />
          : null
      }
    </View>
  )
}

export default ({ musicInfo, onPress }: {
  musicInfo: LX.Music.MusicInfo
  onPress: (listInfo: LX.List.MyListInfo) => void
}) => {
  const [width, setWidth] = useState(0)
  const allList = useMyList()
  const { itemWidth } = listGridLayout(width)

  return (
    <ScrollView style={{ flexGrow: 0, flexShrink: 1 }} onLayout={e => setWidth(e.nativeEvent.layout.width)}>
      <View style={styles.list} onStartShouldSetResponder={() => true}>
        { allList.map(info => <ListItem key={info.id} listInfo={info} musicInfo={musicInfo} onPress={onPress} width={itemWidth} />) }
        <EditListItem itemWidth={itemWidth} />
      </View>
    </ScrollView>
  )
}
