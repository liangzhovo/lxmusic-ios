import { addListMusics, removeListMusics, updateListMusicPosition, updateListMusics } from '@/core/list'
import { playList, playListById, playNext } from '@/core/player/player'
import { addTempPlayList } from '@/core/player/tempPlayList'
import settingState from '@/store/setting/state'
import { similar, sortInsert, toNewMusicInfo, toOldMusicInfo } from '@/utils'
import { confirmDialog, openUrl, shareMusic, toast } from '@/utils/tools'
import { addDislikeInfo, hasDislike } from '@/core/dislikeList'
import playerState from '@/store/player/state'
import { hapticLight } from '@/utils/nativeModules/utils'
import { addDownload, addDownloads } from '@/utils/DownloadManager'
import { showDownloadQualityDialog } from '@/utils/downloadHelper'

import type { SelectInfo } from './ListMenu'
import { type Metadata } from '@/components/MetadataEditModal'
import musicSdk from '@/utils/musicSdk'
import { getListMusicSync } from '@/utils/listManage'
import { clearSongResourceCache } from '@/core/music/cache'

const searchFilterRxp = /\s|'|\.|,|，|&|"|、|\(|\)|（|）|`|~|-|<|>|\||\/|\]|\[|!|！|:|：|;|；|\?|？|·/g
const normalizeSearchText = (str: string | undefined | null) => String(str ?? '').replace(searchFilterRxp, '').toLowerCase()
const getMusicSearchText = (musicInfo: LX.Music.MusicInfo) => `${musicInfo.name ?? ''}${musicInfo.singer ?? ''}${musicInfo.meta.albumName ?? ''}`

export const handlePlay = (listId: SelectInfo['listId'], index: SelectInfo['index']) => {
  hapticLight()
  void playList(listId, index)
}
export const handlePlayLater = (listId: SelectInfo['listId'], musicInfo: SelectInfo['musicInfo'], selectedList: SelectInfo['selectedList'], onCancelSelect: () => void) => {
  if (selectedList.length) {
    addTempPlayList(selectedList.map(s => ({ listId, musicInfo: s })))
    onCancelSelect()
  } else {
    addTempPlayList([{ listId, musicInfo }])
  }
}

export const handleRemove = (listId: SelectInfo['listId'], musicInfo: SelectInfo['musicInfo'], selectedList: SelectInfo['selectedList'], onCancelSelect: () => void) => {
  if (selectedList.length) {
    void confirmDialog({
      message: global.i18n.t('list_remove_music_multi_tip', { num: selectedList.length }),
      confirmButtonText: global.i18n.t('list_remove_tip_button'),
    }).then(isRemove => {
      if (!isRemove) return
      void removeListMusics(listId, selectedList.map(s => s.id))
      onCancelSelect()
    })
  } else {
    void removeListMusics(listId, [musicInfo.id])
  }
}

export const handleUpdateMusicPosition = (position: number, listId: SelectInfo['listId'], musicInfo: SelectInfo['musicInfo'], selectedList: SelectInfo['selectedList'], onCancelSelect: () => void) => {
  if (selectedList.length) {
    void updateListMusicPosition(listId, position, selectedList.map(s => s.id))
    onCancelSelect()
  } else {
    // console.log(listId, position, [musicInfo.id])
    void updateListMusicPosition(listId, position, [musicInfo.id])
  }
}

export const handleUpdateMusicInfo = (listId: SelectInfo['listId'], musicInfo: LX.Music.MusicInfoLocal, newInfo: Metadata) => {
  void updateListMusics([
    {
      id: listId,
      musicInfo: {
        ...musicInfo,
        name: newInfo.name,
        singer: newInfo.singer,
        meta: {
          ...musicInfo.meta,
          albumName: newInfo.albumName,
        },
      },
    },
  ])
}


export const handleShare = (musicInfo: SelectInfo['musicInfo']) => {
  shareMusic(settingState.setting['common.shareType'], settingState.setting['download.fileName'], musicInfo)
}


export const searchListMusic = (list: LX.Music.MusicInfo[], text: string) => {
  text = normalizeSearchText(text)
  if (!text) return []
  const nameMatches: LX.Music.MusicInfo[] = []
  const singerMatches: LX.Music.MusicInfo[] = []
  const albumMatches: LX.Music.MusicInfo[] = []
  const fuzzy: Array<{ num: number, data: LX.Music.MusicInfo }> = []
  const escaped = [...text].map(char => char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')
  const pattern = new RegExp(escaped, 'i')
  for (const music of list) {
    if (normalizeSearchText(music.name).includes(text)) nameMatches.push(music)
    else if (normalizeSearchText(music.singer).includes(text)) singerMatches.push(music)
    else if (normalizeSearchText(music.meta.albumName).includes(text)) albumMatches.push(music)
    else {
      const combined = normalizeSearchText(getMusicSearchText(music))
      if (pattern.test(combined)) sortInsert(fuzzy, { num: similar(text, combined), data: music })
    }
  }
  return [...nameMatches, ...singerMatches, ...albumMatches, ...fuzzy.map(item => item.data).reverse()]
}

export const handleShowMusicSourceDetail = async(minfo: SelectInfo['musicInfo']) => {
  const url = musicSdk[minfo.source as LX.OnlineSource]?.getMusicDetailPageUrl(toOldMusicInfo(minfo))
  if (!url) return
  void openUrl(url)
}

export const clearMusicUrl = async(musicInfo: SelectInfo['musicInfo']) => {
  try {
    await clearSongResourceCache(musicInfo)
  } catch (error) {
    toast(global.i18n.t('list_remove_cache_fail_tip', { msg: (error as Error).message }))
    return
  }
  toast(global.i18n.t('list_remove_cache_success_tip'))
}


export const handleDislikeMusic = async(musicInfo: SelectInfo['musicInfo']) => {
  const confirm = await confirmDialog({
    message: musicInfo.singer ? global.i18n.t('lists_dislike_music_singer_tip', { name: musicInfo.name, singer: musicInfo.singer }) : global.i18n.t('lists_dislike_music_tip', { name: musicInfo.name }),
    cancelButtonText: global.i18n.t('cancel_button_text_2'),
    confirmButtonText: global.i18n.t('confirm_button_text'),
    bgClose: false,
  })
  if (!confirm) return
  await addDislikeInfo([{ name: musicInfo.name, singer: musicInfo.singer }])
  toast(global.i18n.t('lists_dislike_music_add_tip'))
  if (hasDislike(playerState.playMusicInfo.musicInfo)) {
    void playNext(true)
  }
}

/**
 * 我的列表 - 下载管理
 * 将列表歌曲（MusicInfo）转为在线格式后加入下载队列；本地歌曲跳过
 */
const toOnlineMusicInfo = (musicInfo: LX.Music.MusicInfo): LX.Music.MusicInfoOnline | null => {
  if (musicInfo.source == 'local') return null
  return musicInfo.meta.toggleMusicInfo ?? (toNewMusicInfo(toOldMusicInfo(musicInfo)) as LX.Music.MusicInfoOnline)
}

export const handleDownload = (musicInfo: SelectInfo['musicInfo']) => {
  const online = toOnlineMusicInfo(musicInfo)
  if (!online) return
  showDownloadQualityDialog(musicInfo.name, online, quality => {
    hapticLight()
    addDownload(online, quality)
    toast(`${musicInfo.name} 已添加到下载任务`)
  })
}

export const handleMultiDownload = (musicInfos: SelectInfo['selectedList'], onCancelSelect: () => void) => {
  const list = musicInfos
    .map(toOnlineMusicInfo)
    .filter((m): m is LX.Music.MusicInfoOnline => m != null)
  if (list.length === 0) return
  // 批量下载：按第一首歌的可用音质弹一次选择，应用于全部
  showDownloadQualityDialog(`${list.length} 首歌曲`, list[0], quality => {
    hapticLight()
    addDownloads(list, quality)
    toast(`已添加 ${list.length} 首歌曲到下载任务`)
    onCancelSelect()
  })
}

export const handleToggleSource = async(listId: string, musicInfo: LX.Music.MusicInfo, toggleMusicInfo: LX.Music.MusicInfoOnline) => {
  const list = getListMusicSync(listId)
  const oldId = musicInfo.id
  let oldIdx = list.findIndex(m => m.id == oldId)
  if (oldIdx < 0) {
    void addListMusics(listId, [toggleMusicInfo], settingState.setting['list.addMusicLocationType'])
    return true
  }
  const id = toggleMusicInfo.id
  const index = list.findIndex(m => m.id == id)
  const removeIds = [oldId]
  if (index > -1) {
    if (!await confirmDialog({
      message: global.i18n.t('music_toggle__duplicate_tip'),
      cancelButtonText: global.i18n.t('dialog_cancel'),
      confirmButtonText: global.i18n.t('dialog_confirm'),
    })) return false
    removeIds.push(id)
  }
  void removeListMusics(listId, removeIds).then(async() => {
    await addListMusics(listId, [toggleMusicInfo], 'bottom')
    if (index != -1 && index < oldIdx) oldIdx--
    await updateListMusicPosition(listId, oldIdx, [id])
    if (playerState.playMusicInfo.listId == listId && playerState.playMusicInfo.musicInfo?.id == oldId) {
      void playListById(listId, toggleMusicInfo.id)
    }
  })
  return true
}
