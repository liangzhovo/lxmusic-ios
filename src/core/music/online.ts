import { getMusicCacheRevision } from '@/utils/musicCacheRevision'
import { lookupAudioCache, queueAudioCache, invalidateAudioCache, suppressAudioCacheURL } from '@/plugins/player/cache'
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


export const getMusicUrlInfo = async({ musicInfo, quality, isRefresh, allowToggleSource = true, cacheAudio = true, onToggleSource = () => {} }: {
  musicInfo: LX.Music.MusicInfoOnline
  cacheAudio?: boolean
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
  const revision = getMusicCacheRevision(musicInfo.id)
  const stillCurrent = () => revision == getMusicCacheRevision(musicInfo.id)
  const targetQuality = quality ?? getPlayQuality(settingState.setting['player.playQuality'], musicInfo)
  // Complete audio is resolved before URL lookup or source requests, including
  // after a process restart with no network connection.
  if (!isRefresh) {
    const local = await lookupAudioCache(musicInfo, targetQuality)
    if (local && stillCurrent()) return { url: local, quality: targetQuality }
  } else {
    await invalidateAudioCache(musicInfo, targetQuality).catch(() => {})
  }
  const cachedUrl = await getStoreMusicUrl(musicInfo, targetQuality)
  if (cachedUrl && !isRefresh && stillCurrent()) {
    if (cacheAudio) queueAudioCache(musicInfo, targetQuality, cachedUrl)
    return { url: cachedUrl, quality: targetQuality }
  }

  return handleGetOnlineMusicUrl({ musicInfo, quality, onToggleSource, isRefresh: isRefresh || !stillCurrent(), allowToggleSource }).then(({ url, quality: targetQuality, musicInfo: targetMusicInfo, isFromCache }) => {
    if (!stillCurrent()) { suppressAudioCacheURL(url); return { url, quality: targetQuality } }
    if (targetMusicInfo.id != musicInfo.id && !isFromCache) void saveMusicUrl(targetMusicInfo, targetQuality, url).catch(error => { console.warn('Optional URL cache write failed', String(error)) })
    void saveMusicUrl(musicInfo, targetQuality, url, revision).catch(error => { console.warn('Optional URL cache write failed', String(error)) })
    if (cacheAudio) queueAudioCache(musicInfo, targetQuality, url)
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
