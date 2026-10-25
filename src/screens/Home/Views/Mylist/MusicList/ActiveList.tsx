import { forwardRef, useImperativeHandle, useMemo, useState } from 'react'
import { TouchableOpacity, Platform, View } from 'react-native'

import { Icon } from '@/components/common/Icon'
import { BorderWidths } from '@/theme'
import { useTheme } from '@/store/theme/hook'
import { useActiveListId, useListFetching, useMyList } from '@/store/list/hook'
import { createStyle } from '@/utils/tools'
import Text from '@/components/common/Text'
import { LIST_IDS } from '@/config/constant'
import Loading from '@/components/common/Loading'
import { useHorizontalMode } from '@/utils/hooks'
import { useSettingValue } from '@/store/setting/hook'

export interface ActiveListProps {
  listSelector?: React.ReactNode
  onShowSearchBar: () => void
  onLocatePlaying: () => void
}
export interface ActiveListType {
  setVisibleBar: (visible: boolean) => void
}

export default forwardRef<ActiveListType, ActiveListProps>(({ onShowSearchBar, onLocatePlaying, listSelector }, ref) => {
  const theme = useTheme()
  const horizontal = useHorizontalMode()
  const sidebarOwnsTitle = Platform.OS == 'ios' && horizontal
  const currentListId = useActiveListId()
  const allList = useMyList()
  const fetching = useListFetching(currentListId)
  const langId = useSettingValue('common.langId')
  const currentListName = useMemo(() => {
    switch (currentListId) {
      case LIST_IDS.TEMP:
        return global.i18n.t('list_name_temp')
      case LIST_IDS.DEFAULT:
        return global.i18n.t('list_name_default')
      case LIST_IDS.LOVE:
        return global.i18n.t('list_name_love')
      default:
        return allList.find(l => l.id === currentListId)?.name ?? ''
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentListId, langId, allList])
  const [visibleBar, setVisibleBar] = useState(true)

  useImperativeHandle(ref, () => ({
    setVisibleBar(visible) {
      setVisibleBar(visible)
    },
  }))

  const showList = () => {
    if (Platform.OS == 'ios') onLocatePlaying()
    else global.app_event.changeLoveListVisible(true)
  }

  // List owns initial selection; a second delayed selector read could undo a user jump.

  if (listSelector) return <View testID="compact-library-toolbar" pointerEvents={visibleBar ? 'auto' : 'none'}
    style={{ ...styles.currentList, height: 48, opacity: visibleBar ? 1 : 0, borderBottomColor: theme['c-border-background'] }}>
    <View style={{ flex: 1, minWidth: 0 }}>{listSelector}</View>
    <TouchableOpacity testID="library-locate-playing" accessibilityRole="button" accessibilityLabel="定位当前播放歌曲"
      style={styles.currentListBtns} onPress={onLocatePlaying}>
      <Icon color={theme['c-button-font']} name="list-order" />
    </TouchableOpacity>
    {fetching ? <Loading color={theme['c-button-font']} /> : null}
    <TouchableOpacity accessibilityRole="button" accessibilityLabel="搜索当前列表" style={styles.currentListBtns} onPress={onShowSearchBar}>
      <Icon color={theme['c-button-font']} name="search-2" />
    </TouchableOpacity>
  </View>

  return (
    <TouchableOpacity testID="library-locate-playing" accessibilityRole="button" accessibilityLabel={Platform.OS == 'ios' ? '定位当前播放歌曲' : currentListName} onPress={showList} onLongPress={onLocatePlaying} style={{ ...styles.currentList, opacity: visibleBar ? 1 : 0, borderBottomColor: theme['c-border-background'] }}>
      <Icon style={styles.currentListIcon} color={theme['c-button-font']} name="list-order" size={14} />
      { fetching ? <Loading color={theme['c-button-font']} style={styles.loading} /> : null }
      <Text style={styles.currentListText} numberOfLines={1} color={theme['c-button-font']}>{sidebarOwnsTitle ? '定位当前播放歌曲' : currentListName}</Text>
      <TouchableOpacity style={styles.currentListBtns} onPress={onShowSearchBar}>
        <Icon color={theme['c-button-font']} name="search-2" />
      </TouchableOpacity>
    </TouchableOpacity>
  )
})


const styles = createStyle({
  currentList: {
    flexDirection: 'row',
    paddingRight: 2,
    height: 46,
    alignItems: 'center',
    borderBottomWidth: BorderWidths.normal,
    // backgroundColor: 'rgba(0,0,0,0.2)',
  },
  currentListIcon: {
    paddingLeft: 15,
    paddingRight: 10,
    // paddingTop: 10,
    // paddingBottom: 0,
  },
  currentListText: {
    flex: 1,
    // minWidth: 70,
    // paddingLeft: 10,
    paddingRight: 10,
    // paddingTop: 10,
    // paddingBottom: 10,
  },
  loading: {
    marginRight: 5,
  },
  currentListBtns: {
    width: 46,
    justifyContent: 'center',
    alignItems: 'center',
    height: '100%',
    // backgroundColor: 'rgba(0,0,0,0.2)',
  },
})
