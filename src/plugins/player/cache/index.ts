import { getMusicCacheRevision } from '@/utils/musicCacheRevision'
import TrackPlayer, { State } from 'react-native-track-player'
import { exportCompletedStreamingFlac, getStreamingFlacState } from '@/utils/nativeModules/streamingFlac'
import { optionalTask } from './optionalTask'
import { Platform } from 'react-native'
import RNFS from 'react-native-fs'
import { stringMd5 } from 'react-native-quick-md5'
import { Buffer } from '@craftzdog/react-native-buffer'
import settingState from '@/store/setting/state'
import { DiskAudioCache, audioCacheKey, type AudioCacheIO } from './DiskAudioCache'

const userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile'
const root = `${RNFS.LibraryDirectoryPath}/Application Support/LXAudioCache/v1`
let sequence = 0
const io: AudioCacheIO = {
  mkdir: async(path) => RNFS.mkdir(path, { NSURLIsExcludedFromBackupKey: true }),
  list: async(path) => (await RNFS.readDir(path)).map(file => ({ name: file.name, size: Number(file.size), mtime: file.mtime?.getTime() ?? 0, isFile: file.isFile() })),
  read: async(path) => RNFS.readFile(path, 'utf8'),
  write: async(path, text) => RNFS.writeFile(path, text, 'utf8'),
  touch: async(path) => { await RNFS.touch(path, new Date()) },
  head: async(path) => Buffer.from(await RNFS.read(path, 64, 0, 'base64'), 'base64'),
  hash: async(path) => RNFS.hash(path, 'sha256'),
  move: async(from, to) => RNFS.moveFile(from, to),
  copy: async(from, to) => RNFS.copyFile(from, to),
  remove: async(path) => RNFS.unlink(path),
  stat: async(path) => ({ size: Number((await RNFS.stat(path)).size) }),
  digestKey: stringMd5,
  id: () => `${Date.now().toString(36)}-${(++sequence).toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
  log: (event, detail = '') => { console.info('[audio-cache]', event, detail) },
  download: (url, path, maxBytes) => {
    let expected = -1
    let completeRange = false
    let aborted = false
    let jobId: number | undefined
    const cancel = () => {
      aborted = true
      if (jobId !== undefined) RNFS.stopDownload(jobId)
    }
    const task = RNFS.downloadFile({
      fromUrl: url,
      toFile: path,
      headers: { 'User-Agent': userAgent, 'Accept-Encoding': 'identity' },
      background: false,
      cacheable: false,
      connectionTimeout: 15000,
      readTimeout: 60000,
      progressInterval: 200,
      begin: response => {
        expected = response.contentLength
        const rangeHeader = Object.entries(response.headers).find(([name]) => name.toLowerCase() == 'content-range')?.[1]
        const range = typeof rangeHeader == 'string' ? /^bytes 0-(\d+)\/(\d+)$/.exec(rangeHeader) : null
        completeRange = !!range && Number(range[1]) + 1 == Number(range[2]) && expected == Number(range[2])
        if ((response.statusCode != 200 && !(response.statusCode == 206 && completeRange)) || expected > maxBytes) cancel()
      },
      progress: response => { if (response.bytesWritten > maxBytes) cancel() },
    })
    jobId = task.jobId
    if (aborted) RNFS.stopDownload(jobId)
    return {
      cancel,
      done: task.promise.then(result => {
        if (aborted) throw new Error('Cache transfer cancelled')
        return { status: result.statusCode, bytes: result.bytesWritten, expected, completeRange }
      }),
    }
  },
}
const cache = Platform.OS == 'ios' ? new DiskAudioCache(root, io) : null
let configured: number | null = null
let configuring: Promise<void> | null = null
export const configureAudioCache = async(megabytes: number) => {
  if (!cache) return
  const bytes = Number.isFinite(megabytes) ? Math.max(0, megabytes) * 1024 * 1024 : 0
  if (configured == bytes) return
  if (configuring) await configuring
  if (configured == bytes) return
  const task = cache.configure(bytes).then(() => { configured = bytes })
  configuring = task
  try { await task } finally { if (configuring === task) configuring = null }
}
const ready = async() => configureAudioCache(parseInt(settingState.setting['player.cacheSize'] || '0', 10))
const keyFor = (music: LX.Music.MusicInfoOnline, quality: LX.Quality) => audioCacheKey(music.source, music.id, quality)
export const lookupAudioCache = async(music: LX.Music.MusicInfoOnline, quality: LX.Quality) => {
  if (!cache) return null
  return optionalTask(ready().then(async() => cache.lookup(keyFor(music, quality))), 1200, null, 'lookup')
}
export const queueAudioCache = (music: LX.Music.MusicInfoOnline, quality: LX.Quality, url: string) => {
  if (!cache) return
  // Register only. Build 78 started a second request before the audio engine
  // consumed the URL, competing for bandwidth / single-use stream credentials.
  clearedURLs.delete(url)
  pendingKeys.set(url, keyFor(music, quality))
  if (pendingKeys.size > 16) pendingKeys.delete(pendingKeys.keys().next().value!)
}
export const invalidateAudioCache = async(music: LX.Music.MusicInfoOnline, quality: LX.Quality) => {
  if (!cache) return
  await optionalTask(ready().then(async() => cache.invalidate(keyFor(music, quality))), 600, undefined, 'invalidate')
}
/** Explicit user action: do not swallow storage failures or delete other songs. */
export const clearSongAudioCache = async(music: LX.Music.MusicInfoOnline) => {
  if (!cache) return
  const keys = new Set((['128k', '320k', 'flac', 'flac24bit'] as LX.Quality[]).map(q => keyFor(music, q)))
  if (observedKey && keys.has(observedKey)) { suppressAudioCacheURL(observedURL); stopAudioCacheObservation() }
  for (const [url, key] of pendingKeys) { if (keys.has(key)) { suppressAudioCacheURL(url); pendingKeys.delete(url) } }
  await ready()
  for (const key of keys) await cache.invalidate(key, true)
}

export const getAudioCacheSize = async() => {
  if (!cache) return 0
  await ready()
  return cache.size()
}
export const clearAudioCache = async() => {
  if (!cache) return
  stopAudioCacheObservation()
  await ready()
  await cache.clear()
}
export const acquireAudioCacheURL = async(url: string) => {
  // No cache code (including init) may delay a remote resource.
  if (!cache || !url.startsWith('file:')) return url
  const lease = await optionalTask(cache.acquire(url), 1800, null, 'playback-lease')
  if (!lease) throw new Error('Cached file unavailable; retrying online playback')
  return lease
}
export const releaseAudioCacheURL = async(url: string) => cache?.release(url)

let currentPlaybackURL = ''
export const adoptAudioCacheURL = async(url: string) => {
  const old = currentPlaybackURL
  currentPlaybackURL = url
  if (old && old != url) await releaseAudioCacheURL(old)
}

const pendingKeys = new Map<string, string>()
const clearedURLs = new Set<string>()
export const suppressAudioCacheURL = (url: string) => { clearedURLs.add(url) }
let observedURL = ''
let observedKey: string | null = null
let observation = 0
let observationTimer: ReturnType<typeof setTimeout> | null = null
export const stopAudioCacheObservation = () => {
  observation++
  observedKey = null
  if (observationTimer) clearTimeout(observationTimer)
  observationTimer = null
  cache?.cancelPending()
}

/** Observe the actual player, never pre-download before audio starts.
 * FLAC saves its existing response. System-player caching is deferred until
 * the *entire* track is buffered, so it cannot starve startup/rebuffering. */
export const observePlaybackAudioCache = (music: LX.Player.PlayMusic, url: string, quality?: LX.Quality | null) => {
  stopAudioCacheObservation()
  if (!cache || clearedURLs.has(url) || !/^https?:\/\//i.test(url) || !quality || 'progress' in music || music.source == 'local') return
  const token = observation
  const key = pendingKeys.get(url) ?? keyFor(music, quality)
  observedKey = key
  observedURL = url
  const revision = getMusicCacheRevision(music.id)
  const native = quality == 'flac' || quality == 'flac24bit'
  let attempts = 0
  const current = () => token == observation && revision == getMusicCacheRevision(music.id)
  const poll = async() => {
    if (!current() || ++attempts > 1200) return
    let completed = false
    try {
      await ready()
      if (!current() || !configured) return
      if (native) {
        const state = await optionalTask(getStreamingFlacState(), 1000, 'idle' as const, 'native-state')
        if (state == 'playing' || state == 'paused') {
          const file = await optionalTask(exportCompletedStreamingFlac(url), 3000, null, 'stream-export')
          if (file) {
            try {
              if (current()) await cache.importCompleteFile(key, file, current)
              completed = current()
            } finally { await RNFS.unlink(file).catch(() => {}) }
          }
        }
      } else {
        const state = await optionalTask(TrackPlayer.getState(), 1000, State.None, 'system-state')
        if (state == State.Playing || state == State.Paused) {
          const progress = await optionalTask(Promise.all([TrackPlayer.getBufferedPosition(), TrackPlayer.getDuration()]), 1000, [0, 0], 'system-buffer')
          if (current() && progress[1] > 0 && progress[0] >= progress[1] - 0.25) {
            await cache.prefetch(key, url)
            completed = true
          }
        }
      }
    } catch (error) { console.warn('[audio-cache] optional persistence failed', String(error)) }
    if (current() && !completed) observationTimer = setTimeout(() => { void poll() }, 1500)
  }
  observationTimer = setTimeout(() => { void poll() }, 1500)
}
