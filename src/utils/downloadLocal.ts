/**
 * 本地下载索引（歌单离线下载专用，与播放缓存完全隔离）
 *
 * 为什么不用音频缓存：缓存带 LRU 淘汰、播放 lease（1800ms 超时）与串行锁，
 * 用户下载塞进去会被淘汰、也会让播放等锁卡住。下载文件只放本机目录，
 * 用这个轻量索引做"是否已下载 / 本地路径"查询，播放优先命中。
 */
import RNFS from 'react-native-fs'
import AsyncStorage from '@react-native-async-storage/async-storage'

const STORAGE_KEY = 'lx_music_download_index_v1'
const MAX_ENTRIES = 5000
const EXISTS_TIMEOUT = 300

export interface LocalDownloadEntry {
  /** `${source}|${id}` */
  key: string
  /** `${source}|${normalized(name)}|${normalized(singer)}` */
  alias: string
  /** 原始字段，供列表徽标按「source|name|singer」直接命中 */
  source: string
  name: string
  singer: string
  localPath: string
  quality?: LX.Quality
  size: number
  createdAt: number
}

let entries: LocalDownloadEntry[] = []
let byKey = new Map<string, LocalDownloadEntry>()
let byAlias = new Map<string, LocalDownloadEntry>()
let loaded = false
let saveTimer: ReturnType<typeof setTimeout> | null = null

/** 归一化：去空白、去常见分隔符、转小写（列表项与下载项命名可能不一致） */
const norm = (s?: string | null) => String(s ?? '').replace(/[\s·・、,，/]/g, '').toLowerCase()
const keyOf = (m: { source?: string, id?: string }) => `${m.source ?? ''}|${m.id ?? ''}`
const aliasOf = (m: { source?: string, name?: string, singer?: string }) => `${m.source ?? ''}|${norm(m.name)}|${norm(m.singer)}`

/** file:// + 分段编码（中文/空格必须编码，否则 iOS 播放器 URL 解析失败） */
export const toFileURL = (path: string) => `file://${path.split('/').map(encodeURIComponent).join('/')}`

const rebuild = () => {
  byKey = new Map()
  byAlias = new Map()
  for (const e of entries) {
    byKey.set(e.key, e)
    byAlias.set(e.alias, e)
  }
}

const persist = () => {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(entries)).catch(() => {})
  }, 300)
}

const isValidEntry = (e: unknown): e is LocalDownloadEntry => {
  if (!e || typeof e !== 'object') return false
  const entry = e as Partial<LocalDownloadEntry>
  return typeof entry.localPath === 'string' && entry.localPath.length > 0 &&
    typeof entry.key === 'string' && typeof entry.alias === 'string' &&
    typeof entry.source === 'string' && typeof entry.name === 'string' && typeof entry.singer === 'string'
}

/** 启动时加载索引；downloadTasks 恢复时也会调用 */
export const loadLocalDownloadIndex = async() => {
  if (loaded) return
  loaded = true
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const arr = JSON.parse(raw) as unknown
    if (!Array.isArray(arr)) return
    entries = arr.filter(isValidEntry).slice(-MAX_ENTRIES)
    rebuild()
  } catch {
    entries = []
    rebuild()
  }
}

export const registerLocalDownload = (musicInfo: LX.Music.MusicInfoOnline, localPath: string, quality?: LX.Quality, size = 0) => {
  const key = keyOf(musicInfo)
  const alias = aliasOf(musicInfo)
  entries = entries.filter(e => e.key !== key && e.localPath !== localPath)
  entries.push({
    key,
    alias,
    source: String(musicInfo.source ?? ''),
    name: String(musicInfo.name ?? ''),
    singer: String(musicInfo.singer ?? ''),
    localPath,
    quality,
    size,
    createdAt: Date.now(),
  })
  if (entries.length > MAX_ENTRIES) entries = entries.slice(-MAX_ENTRIES)
  rebuild()
  persist()
}

export const unregisterLocalDownload = (localPath: string) => {
  const next = entries.filter(e => e.localPath !== localPath)
  if (next.length === entries.length) return
  entries = next
  rebuild()
  persist()
}

export const clearLocalDownloads = () => {
  entries = []
  rebuild()
  persist()
}

/** 同步查索引（不碰磁盘，毫秒级） */
export const findLocalDownload = (musicInfo: { source?: string, id?: string, name?: string, singer?: string }) => {
  return byKey.get(keyOf(musicInfo)) ?? byAlias.get(aliasOf(musicInfo)) ?? null
}

/** 保证索引已加载（启动早期播放时也能命中），最多等 500ms */
async function ensureIndexLoaded() {
  if (loaded) return
  await Promise.race([
    loadLocalDownloadIndex(),
    new Promise<void>(resolve => { setTimeout(resolve, 500) }),
  ])
}

/**
 * 查询本地已下载文件，返回播放器可直接使用的 file:// URL
 * 命中索引后仅做一次带超时的存在性校验，避免任何挂起风险
 */
export const getDownloadedFilePath = async(musicInfo: LX.Music.MusicInfoOnline): Promise<string | null> => {
  await ensureIndexLoaded()
  const entry = findLocalDownload(musicInfo)
  if (!entry) return null
  const exists = await Promise.race([
    RNFS.exists(entry.localPath).catch(() => false),
    new Promise<boolean>(resolve => { setTimeout(() => { resolve(false) }, EXISTS_TIMEOUT) }),
  ])
  if (!exists) {
    // 文件被删除（例如用户清理），顺手摘掉索引，避免反复无效查询
    unregisterLocalDownload(entry.localPath)
    return null
  }
  return toFileURL(entry.localPath)
}

/** 已下载标识集合（id、归一化别名、原始 source|name|singer 三套键），供列表徽标使用 */
export const getLocalDownloadedIdSet = (): Set<string> => {
  const set = new Set<string>()
  for (const e of entries) {
    set.add(e.key.split('|')[1] ?? '')
    set.add(e.alias)
    set.add(`${e.source}|${e.name}|${e.singer}`)
  }
  return set
}

/** 徽标用的稳定签名：只有"已下载集合"变化时才需要重渲染列表 */
export const getLocalDownloadedSignature = () => entries.map(e => e.key).sort().join(',')

export const getLocalDownloadEntries = () => [...entries]
