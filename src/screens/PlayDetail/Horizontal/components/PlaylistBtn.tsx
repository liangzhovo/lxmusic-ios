import { SONG_ROW_HEIGHT } from '@/utils/songLayout'
import { useEffect, useRef, useState } from 'react'
import { FlatList, TouchableOpacity, View } from 'react-native'
import Popup, { type PopupType } from '@/components/common/Popup'
import Text from '@/components/common/Text'
import { Icon } from '@/components/common/Icon'
import { getList } from '@/core/player/playInfo'
import { getListMusics } from '@/utils/listManage'
import { playListById, togglePlay } from '@/core/player/player'
import { markTimeoutExitInteraction } from '@/core/player/timeoutExit'
import { usePlayInfo, usePlayMusicInfo, useIsPlay } from '@/store/player/hook'
import { useTheme } from '@/store/theme/hook'
import { playingColor } from '@/utils/playingColor'
import { overlaySurface } from '@/utils/overlaySurface'
import { toast } from '@/utils/tools'
import { LIST_IDS } from '@/config/constant'
import useSongKeyboard from '@/utils/hooks/useSongKeyboard'
import Btn from './Btn'
import PlaylistIcon from '@/components/common/PlaylistIcon'
import SongRowContent from '@/components/common/SongRowContent'

type Music = LX.Music.MusicInfo | LX.Download.ListItem
export const PlaylistContents = ({ list, visible, onSelect }: { list: Music[], visible: boolean, onSelect: (item: Music) => void }) => {
  const current = usePlayMusicInfo()
  const playing = useIsPlay()
  const theme = useTheme()
  const surface = String(overlaySurface(theme).backgroundColor)
  const playingForeground = playingColor(theme, surface)
  const ref = useRef<FlatList<Music>>(null)
  const currentIndex = list.findIndex(item => item.id == current.musicInfo?.id)
  const scroll = (index: number) => {
    if (index < 0 || index >= list.length) return
    ref.current?.scrollToIndex({ index, viewPosition: 0.35, animated: false })
  }
  const locate = () => {
    if (currentIndex < 0) { toast('当前歌曲不在此列表中'); return }
    scroll(currentIndex)
  }
  const keyboardId = useSongKeyboard(list, onSelect, scroll, current.musicInfo?.id, visible)
  // Also runs after async list restoration, not only the initial empty render.
  useEffect(() => {
    if (!visible || currentIndex < 0) return
    const frame = requestAnimationFrame(locate)
    return () => cancelAnimationFrame(frame)
  }, [visible, currentIndex, list])
  return <View style={{ flex: 1, minHeight: 0 }}>
    <TouchableOpacity accessibilityRole="button" accessibilityLabel="定位正在播放的歌曲" disabled={currentIndex < 0} onPress={locate}
      style={{ minHeight: 44, paddingHorizontal: 16, justifyContent: 'center', borderBottomWidth: .5, borderBottomColor: theme['c-border-background'] }}>
      <Text color={theme['c-primary-font']}>{currentIndex >= 0 ? `定位正在播放 · ${currentIndex + 1} / ${list.length}` : `播放列表 · ${list.length} 首`}</Text>
    </TouchableOpacity>
    <FlatList<Music> ref={ref} data={list} style={{ flex: 1 }} extraData={[current.musicInfo?.id, playing, keyboardId]}
      keyExtractor={item => item.id} initialNumToRender={10}
      getItemLayout={(_data, index) => ({ length: SONG_ROW_HEIGHT, offset: SONG_ROW_HEIGHT * index, index })}
      onLayout={() => { if (visible && currentIndex >= 0) scroll(currentIndex) }}
      onScrollToIndexFailed={({ index }) => { ref.current?.scrollToOffset({ offset: index * SONG_ROW_HEIGHT, animated: false }) }}
      ListEmptyComponent={<Text style={{ padding: 20 }}>当前播放列表为空</Text>}
      renderItem={({ item, index }) => {
        const info = 'progress' in item ? item.metadata.musicInfo : item
        const active = item.id == current.musicInfo?.id
        const focused = item.id == keyboardId
        return <TouchableOpacity accessibilityRole="button" accessibilityState={{ selected: active }}
          accessibilityLabel={`${active ? playing ? '正在播放' : '当前歌曲已暂停' : ''} ${info.name} ${info.singer}`}
          onPress={() => onSelect(item)} style={{ height: SONG_ROW_HEIGHT, paddingHorizontal: 12, gap: 8, flexDirection: 'row', alignItems: 'center',
            backgroundColor: 'transparent' }}>
          {focused ? <View pointerEvents="none" style={{ position: 'absolute', left: 1, right: 1, top: 1, bottom: 1, borderWidth: 1, borderRadius: 4, borderColor: playingForeground }} /> : null}
          <View style={{ width: 22, alignItems: 'center' }}>{active ? <Icon name="play-outline" size={14} color={playingForeground} />
            : <Text size={11} color={theme['c-font-label']}>{index + 1}</Text>}</View>
          <SongRowContent name={info.name} singer={info.singer} album={info.meta.albumName} interval={info.interval} source={info.source} active={active} surface={surface} showAlbum={false} />
        </TouchableOpacity>
      }} />
  </View>
}
export default () => {
  const popupRef = useRef<PopupType>(null)
  const [list, setList] = useState<Music[]>([])
  const [listId, setListId] = useState<string | null>(null)
  const [visible, setVisible] = useState(false)
  const sequence = useRef(0)
  const playInfo = usePlayInfo()
  const current = usePlayMusicInfo()
  const restore = async(id: string | null, request: number) => {
    let rows: Music[] = [...getList(id)]
    if (id && id != LIST_IDS.DOWNLOAD) {
      try { rows = [...await getListMusics(id)] } catch { /* Current track still remains accessible. */ }
    }
    if (request != sequence.current) return
    // Temporary/online songs may not belong to a saved source list.
    const active = current.musicInfo
    if (active && !rows.some(item => item.id == active.id)) rows.unshift(active)
    setList(rows)
  }
  useEffect(() => {
    if (!visible) return
    const activeList = current.listId ?? playInfo.playerListId
    if (activeList != listId) { setListId(activeList); return }
    const update = (ids: string[]) => { if (listId && ids.includes(listId)) void restore(listId, ++sequence.current) }
    global.app_event.on('myListMusicUpdate', update)
    void restore(listId, ++sequence.current)
    return () => { global.app_event.off('myListMusicUpdate', update) }
  }, [visible, listId, current.musicInfo?.id, current.listId, playInfo.playerListId])
  useEffect(() => () => { ++sequence.current }, [])
  const show = () => {
    const id = current.listId ?? playInfo.playerListId
    setListId(id)
    setList([...getList(id)])
    setVisible(true)
    popupRef.current?.setVisible(true)
  }
  const select = (item: Music) => {
    markTimeoutExitInteraction()
    if (item.id == current.musicInfo?.id) { togglePlay(); return }
    if (!listId) { toast('该歌曲不属于已保存列表'); return }
    void playListById(listId, item.id).catch(() => toast('播放失败，请重试'))
  }
  return <>
    <Btn label="播放列表" onPress={show}><PlaylistIcon /></Btn>
    <Popup ref={popupRef} position="left" kind="player-playlist" title="播放列表" onHide={() => { ++sequence.current; setVisible(false) }}>
      <PlaylistContents list={list} visible={visible} onSelect={select} />
    </Popup>
  </>
}
