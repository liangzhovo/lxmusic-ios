import { View, Platform } from 'react-native'
import Text from '@/components/common/Text'
import ListActionBar from '@/components/common/ListActionBar'
import { useHorizontalMode } from '@/utils/hooks'
import { toast } from '@/utils/tools'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import OnlineList, { type OnlineListType, type OnlineListProps } from '@/components/OnlineList'
import { clearListDetail, getListDetail, setListDetail, setListDetailInfo } from '@/core/leaderboard'
import boardState from '@/store/leaderboard/state'
import { handlePlay, handleCollect } from './listAction'

// export type MusicListProps = Pick<OnlineListProps,
// 'onLoadMore'
// | 'onPlayList'
// | 'onRefresh'
// >

export interface MusicListType {
  loadList: (source: LX.OnlineSource, listId: string) => void
}

export default forwardRef<MusicListType, {}>((props, ref) => {
  const horizontal = useHorizontalMode()
  const wide = Platform.OS == 'ios' && horizontal
  const [board, setBoard] = useState<{ name: string, id: string, source: LX.OnlineSource | null }>({ name: '排行榜', id: '', source: null })
  const listRef = useRef<OnlineListType>(null)
  const isUnmountedRef = useRef(false)
  const loadRequestIdRef = useRef(0)
  const currentListIdRef = useRef('')

  const applyListResult = useCallback((requestId: number, listId: string, page: number, result: typeof boardState.listDetailInfo, append = false) => {
    if (isUnmountedRef.current) return
    if (requestId != loadRequestIdRef.current) return
    if (listId != currentListIdRef.current) return
    requestAnimationFrame(() => {
      listRef.current?.setList(result.list, append)
      listRef.current?.setStatus(boardState.listDetailInfo.maxPage <= page ? 'end' : 'idle')
    })
  }, [])

  const handleLoadFirstPage = useCallback(async(id: string, requestId: number) => {
    const page = 1
    setListDetailInfo(id)

    let listDetail = await getListDetail(id, page)
    let result = setListDetail(listDetail, id, page)
    if (!result.list.length) {
      clearListDetail()
      setListDetailInfo(id)
      listDetail = await getListDetail(id, page, true)
      result = setListDetail(listDetail, id, page)
    }

    applyListResult(requestId, id, page, result)
  }, [applyListResult])

  useImperativeHandle(ref, () => ({
    async loadList(source, id) {
      const requestId = ++loadRequestIdRef.current
      currentListIdRef.current = id
      setBoard({ id, source, name: boardState.boards[source]?.list.find(item => item.id == id)?.name ?? '排行榜' })
      const listDetailInfo = boardState.listDetailInfo
      listRef.current?.setList([])
      if (listDetailInfo.id == id && listDetailInfo.source == source && listDetailInfo.list.length) {
        applyListResult(requestId, id, listDetailInfo.page, listDetailInfo)
      } else {
        listRef.current?.setStatus('loading')
        return handleLoadFirstPage(id, requestId).catch(() => {
          if (boardState.listDetailInfo.list.length) clearListDetail()
          if (requestId != loadRequestIdRef.current) return
          listRef.current?.setStatus('error')
        })
      }
    },
  }), [applyListResult, handleLoadFirstPage])

  useEffect(() => {
    isUnmountedRef.current = false
    return () => {
      isUnmountedRef.current = true
    }
  }, [])


  const handlePlayList: OnlineListProps['onPlayList'] = (index) => {
    const listDetailInfo = boardState.listDetailInfo
    // console.log(boardState.listDetailInfo)
    void handlePlay(listDetailInfo.id, listDetailInfo.list, index)
  }
  const handleRefresh: OnlineListProps['onRefresh'] = () => {
    const requestId = ++loadRequestIdRef.current
    currentListIdRef.current = boardState.listDetailInfo.id
    const page = 1
    listRef.current?.setStatus('refreshing')
    getListDetail(boardState.listDetailInfo.id, page, true).then((listDetail) => {
      const result = setListDetail(listDetail, boardState.listDetailInfo.id, page)
      applyListResult(requestId, boardState.listDetailInfo.id, page, result)
    }).catch(() => {
      if (boardState.listDetailInfo.list.length && page == 1) clearListDetail()
      if (requestId != loadRequestIdRef.current) return
      listRef.current?.setStatus('error')
    })
  }
  const handleLoadMore: OnlineListProps['onLoadMore'] = () => {
    const requestId = loadRequestIdRef.current
    const listId = boardState.listDetailInfo.id
    listRef.current?.setStatus('loading')
    const page = boardState.listDetailInfo.list.length ? boardState.listDetailInfo.page + 1 : 1
    getListDetail(listId, page).then((listDetail) => {
      const result = setListDetail(listDetail, listId, page)
      applyListResult(requestId, listId, page, result, true)
    }).catch(() => {
      if (boardState.listDetailInfo.list.length && page == 1) clearListDetail()
      if (requestId != loadRequestIdRef.current || listId != currentListIdRef.current) return
      listRef.current?.setStatus('error')
    })
  }

  return <View style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
    {wide ? <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 76, padding: 16, gap: 12 }}>
      <Text size={18} style={{ flex: 1, minWidth: 0, fontWeight: '600' }} numberOfLines={2}>{board.name}</Text>
      <View style={{ width: 248, maxWidth: '65%', flexShrink: 0 }}><ListActionBar actions={[
        { label: '播放全部', disabled: !board.id, onPress: () => {
          if (board.id) void handlePlay(board.id, boardState.listDetailInfo.list).catch(() => toast('播放失败，请重试'))
        } },
        { label: '收藏歌单', disabled: !board.id, onPress: () => {
          if (board.id && board.source) void handleCollect(board.id, board.name, board.source).catch(() => toast('收藏失败，请重试'))
        } },
      ]} /></View>
    </View> : null}
    <OnlineList
    ref={listRef}
    onPlayList={handlePlayList}
    onRefresh={handleRefresh}
    onLoadMore={handleLoadMore}
    checkHomePagerIdle
    rowType='medium'
   />
  </View>
})

