import {
  saveLyric,
  saveMusicUrl,
  getMusicUrl as getStoreMusicUrl,
} from '@/utils/data'
import { updateListMusics } from '@/core/list'
import settingState from '@/store/setting/state'

import {
  buildLyricInfo,
  getPlayQuality,
  handleGetOnlineLyricInfo,
  handleGetOnlineMusicUrl,
  handleGetOnlinePicUrl,
  getCachedLyricInfo,
} from './utils'
import { getDownloadedFilePath, getLocalLyricText, getLocalPicPath } from '@/utils/downloadLocal'

/* export const setMusicUrl = ({ musicInfo, type, url }: {
  musicInfo: LX.Music.MusicInfo
  type: LX.Quality
  url: string
}) => {
  saveMusicUrl(musicInfo, type, url)
}

export const setPic = (datas: {
  listId: string
  musicInfo: LX.Music.MusicInfo
  url: string
}) => {
  datas.musicInfo.img = datas.url
  updateMusicInfo({
    listId: datas.listId,
    id: datas.musicInfo.songmid,
    data: { img: datas.url },
    musicInfo: datas.musicInfo,
  })
}
 */


export const getMusicUrlInfo = async({ musicInfo, quality, isRefresh, allowToggleSource = true, onToggleSource = () => {} }: {
  musicInfo: LX.Music.MusicInfoOnline
  quality?: LX.Quality
  isRefresh: boolean
  allowToggleSource?: boolean
  onToggleSource?: (musicInfo?: LX.Music.MusicInfoOnline) => void
}): Promise<{ url: string, quality: LX.Quality | null }> => {
  // if (!musicInfo._types[type]) {
  //   // 兼容旧版酷我源搜索列表过滤128k音质的bug
  //   if (!(musicInfo.source == 'kw' && type == '128k')) throw new Error('该歌曲没有可播放的音频')

  //   // return Promise.reject(new Error('该歌曲没有可播放的音频'))
  // }
  // 播放（非强制刷新）时优先使用已下载的本地文件，不联网
  if (!isRefresh) {
    try {
      // 本地查询加 3 秒超时保护，防止异常挂起导致播放卡在"获取链接中"
      const localPath = await Promise.race([
        getDownloadedFilePath(musicInfo),
        new Promise<string | null>(resolve => { setTimeout(() => { resolve(null) }, 3000) }),
      ])
      if (localPath) {
        console.log('local playback hit:', localPath)
        return { url: localPath, quality: quality ?? null }
      }
      console.log('local playback miss:', musicInfo.id, musicInfo.name)
    } catch (e) {
      // 本地查询异常时回落到正常网络获取，避免播放卡在"获取链接中"
      console.log('local download check failed:', e)
    }
  }
  const targetQuality = quality ?? getPlayQuality(settingState.setting['player.playQuality'], musicInfo)
  const cachedUrl = await getStoreMusicUrl(musicInfo, targetQuality)
  if (cachedUrl && !isRefresh) return { url: cachedUrl, quality: targetQuality }

  return handleGetOnlineMusicUrl({ musicInfo, quality, onToggleSource, isRefresh, allowToggleSource }).then(({ url, quality: targetQuality, musicInfo: targetMusicInfo, isFromCache }) => {
    if (targetMusicInfo.id != musicInfo.id && !isFromCache) void saveMusicUrl(targetMusicInfo, targetQuality, url)
    void saveMusicUrl(musicInfo, targetQuality, url)
    return { url, quality: targetQuality }
  })
}

export const getMusicUrl = async(args: {
  musicInfo: LX.Music.MusicInfoOnline
  quality?: LX.Quality
  isRefresh: boolean
  allowToggleSource?: boolean
  onToggleSource?: (musicInfo?: LX.Music.MusicInfoOnline) => void
}) => getMusicUrlInfo(args).then(({ url }) => url)

export const getPicUrl = async({ musicInfo, listId, isRefresh, allowToggleSource = true, onToggleSource = () => {} }: {
  musicInfo: LX.Music.MusicInfoOnline
  listId?: string | null
  isRefresh: boolean
  allowToggleSource?: boolean
  onToggleSource?: (musicInfo?: LX.Music.MusicInfoOnline) => void
}): Promise<string> => {
  if (!isRefresh) {
    // 优先使用下载时保存的本地封面（无网络也可显示）
    try {
      const localPic = await getLocalPicPath(musicInfo)
      if (localPic) return localPic
    } catch (e) {
      console.log('local pic check failed:', e)
    }
  }
  if (musicInfo.meta.picUrl && !isRefresh) return musicInfo.meta.picUrl
  return handleGetOnlinePicUrl({ musicInfo, onToggleSource, isRefresh, allowToggleSource }).then(({ url, musicInfo: targetMusicInfo, isFromCache }) => {
    // picRequest = null
    if (listId) {
      musicInfo.meta.picUrl = url
      void updateListMusics([{ id: listId, musicInfo }])
    }
    // savePic({ musicInfo, url, listId })
    return url
  })
}
export const getLyricInfo = async({ musicInfo, isRefresh, allowToggleSource = true, onToggleSource = () => {} }: {
  musicInfo: LX.Music.MusicInfoOnline
  isRefresh: boolean
  allowToggleSource?: boolean
  onToggleSource?: (musicInfo?: LX.Music.MusicInfoOnline) => void
}): Promise<LX.Player.LyricInfo> => {
  if (!isRefresh) {
    // 优先使用下载时保存的本地歌词（无网络也可显示）
    try {
      const lrc = await getLocalLyricText(musicInfo)
      if (lrc) return buildLyricInfo({ lyric: lrc })
    } catch (e) {
      console.log('local lyric check failed:', e)
    }
    const lyricInfo = await getCachedLyricInfo(musicInfo)
    if (lyricInfo) return buildLyricInfo(lyricInfo)
  }

  // lrcRequest = music[musicInfo.source].getLyric(musicInfo)
  return handleGetOnlineLyricInfo({ musicInfo, onToggleSource, isRefresh, allowToggleSource }).then(async({ lyricInfo, musicInfo: targetMusicInfo, isFromCache }) => {
    // lrcRequest = null
    if (isFromCache) return buildLyricInfo(lyricInfo)
    void saveLyric(musicInfo, lyricInfo)
    if (targetMusicInfo.id != musicInfo.id) void saveLyric(targetMusicInfo, lyricInfo)

    return buildLyricInfo(lyricInfo)
  })
}
