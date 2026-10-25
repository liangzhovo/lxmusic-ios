import { Platform } from 'react-native'
import { clearMusicUrlByMusic, hasMusicUrlByMusic, qualitys } from '@/utils/data'
import { clearSongAudioCache, lookupAudioCache } from '@/plugins/player/cache'

export const hasSongResourceCache = async(music: LX.Music.MusicInfo) => {
  if (await hasMusicUrlByMusic(music)) return true
  if (Platform.OS != 'ios' || music.source == 'local') return false
  const hits = await Promise.all(qualitys.map(async(q) => lookupAudioCache(music, q)))
  return hits.some(Boolean)
}

export const clearSongResourceCache = async(music: LX.Music.MusicInfo) => {
  // Revision changes before either asynchronous operation. Do not use the
  // optional playback fallback here: a failed clear must not show success.
  const urlTask = clearMusicUrlByMusic(music)
  const audioTask = music.source == 'local' ? Promise.resolve() : clearSongAudioCache(music)
  const results = await Promise.allSettled([urlTask, audioTask])
  for (const result of results) { if (result.status == 'rejected') throw result.reason }
}
