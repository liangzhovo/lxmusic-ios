/**
 * 下载管理器（歌单离线下载）
 *
 * 设计要点（与播放缓存解耦）：
 * - 文件落在本机 Documents/lx-music-downloads，不进入音频缓存（避免 LRU 淘汰与播放 lease 争锁）
 * - 完成后写入 downloadLocal 索引，播放链路优先命中索引
 * - 歌词/封面与音频同 base 保存，导出时可一并打包
 * - 所有外部等待（取链、下载、歌词、封面）都有超时兜底，避免"UI 正常但播放/队列卡住"
 */
import RNFS from 'react-native-fs'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Buffer } from '@craftzdog/react-native-buffer'
import { getMusicUrlInfo, getLyricInfo, getPicUrl } from '@/core/music/online'
import { requestMsg } from '@/utils/message'
import {
  getLocalDownloadedIdSet,
  loadLocalDownloadIndex,
  registerLocalDownload,
  unregisterLocalDownload,
} from './downloadLocal'

const STORAGE_KEY = 'lx_music_download_tasks_v2'
const DOWNLOAD_DIR = RNFS.DocumentDirectoryPath + '/lx-music-downloads'

const MAX_CONCURRENT = 1
const MAX_RETRY = 3
const URL_TIMEOUT = 30000
const DOWNLOAD_SETTLE_TIMEOUT = 10 * 60 * 1000
const PIC_TIMEOUT = 20000
const LYRIC_TIMEOUT = 10000
const SAVE_DEBOUNCE = 1000
const RETRY_BASE_DELAY = 2000
const RETRY_MAX_DELAY = 30000
const NAME_MAX_LEN = 90
const DEFAULT_QUALITY: LX.Quality = '320k'

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'
const REFERER_MAP: Record<string, string> = {
  kw: 'https://www.kuwo.cn/',
  kg: 'https://www.kugou.com/',
  tx: 'https://y.qq.com/',
  wy: 'https://music.163.com/',
  mg: 'https://music.migu.cn/',
}
const EXT_BY_URL: Array<[RegExp, string]> = [
  [/\.flac(\?|$)/i, 'flac'],
  [/\.ape(\?|$)/i, 'ape'],
  [/\.m4a(\?|$)/i, 'm4a'],
  [/\.wav(\?|$)/i, 'wav'],
  [/\.aac(\?|$)/i, 'aac'],
]

export type DownloadStatus = 'waiting' | 'preparing' | 'downloading' | 'paused' | 'completed' | 'failed' | 'cancelled'

export interface DownloadTask {
  id: string
  musicInfo: LX.Music.MusicInfoOnline
  status: DownloadStatus
  progress: number
  downloadedBytes: number
  totalBytes: number
  speed: number
  quality?: LX.Quality
  errorMessage?: string
  localPath?: string
  createdAt: number
  completedAt?: number
  retryCount: number
  /** 指数退避：早于该时间点不会被队列取走 */
  nextRetryAt?: number
}

type TaskListener = (tasks: DownloadTask[]) => void

let tasks: DownloadTask[] = []
const listeners = new Set<TaskListener>()
const activeDownloads = new Map<string, { jobId: number }>()
/** 取消标记：仅用于"正在进行的任务被暂停/删除"，用完即删 */
const cancelledTasks = new Set<string>()
/** abort handle：iOS 上 job.stop() 可能让 promise 永不结算，用它主动解挂 */
const abortControllers = new Map<string, { reject: (e: Error) => void }>()
let isProcessing = false
let retryTimer: ReturnType<typeof setTimeout> | null = null

const ensureDir = async() => {
  try {
    if (!await RNFS.exists(DOWNLOAD_DIR)) await RNFS.mkdir(DOWNLOAD_DIR)
  } catch (e) {
    console.warn('[download] mkdir failed', String(e))
  }
}

/** 给任意 promise 加超时兜底（超时返回 fallback，不抛错，避免卡死调用方） */
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return Promise.race([
    promise.catch(() => fallback),
    new Promise<T>(resolve => { setTimeout(() => { resolve(fallback) }, timeoutMs) }),
  ])
}

const notify = () => {
  const snapshot = [...tasks]
  listeners.forEach(l => { l(snapshot) })
  saveTasks()
}

/** 只持久化必要字段，避免每次进度回调都序列化完整对象 */
let saveTimer: ReturnType<typeof setTimeout> | null = null
const saveTasks = () => {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    const persist = tasks.map(t => ({
      id: t.id,
      musicInfo: t.musicInfo,
      status: (t.status === 'downloading' || t.status === 'preparing') ? 'waiting' as DownloadStatus : t.status,
      quality: t.quality,
      localPath: t.localPath,
      createdAt: t.createdAt,
      completedAt: t.completedAt,
      retryCount: t.retryCount,
      progress: t.status === 'completed' ? 1 : 0,
      downloadedBytes: 0,
      totalBytes: 0,
      speed: 0,
      errorMessage: t.errorMessage,
    }))
    void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(persist)).catch((e: unknown) => {
      console.warn('[download] persist failed', String(e))
    })
  }, SAVE_DEBOUNCE)
}

export const loadTasks = async() => {
  void loadLocalDownloadIndex()
  try {
    const data = await AsyncStorage.getItem(STORAGE_KEY)
    if (!data) return
    const loaded = JSON.parse(data) as unknown
    if (!Array.isArray(loaded)) return
    tasks = (loaded as DownloadTask[])
      .filter(t => t && typeof t.id === 'string' && t.musicInfo)
      .map(t => ({
        ...t,
        status: (t.status === 'downloading' || t.status === 'preparing') ? 'waiting' : t.status,
        progress: t.status === 'completed' ? 1 : 0,
        downloadedBytes: 0,
        totalBytes: 0,
        speed: 0,
        nextRetryAt: undefined,
      }))
    notify()
    // 兼容旧版本：已完成任务的 localPath 可能是历史缓存路径，这里重建本地索引，
    // 让播放与徽标立即可用（文件若已被清理由查索引时的存在性校验自动剔除）
    for (const t of tasks) {
      if (t.status === 'completed' && t.localPath) registerLocalDownload(t.musicInfo, t.localPath, t.quality)
    }
    if (tasks.some(t => t.status === 'waiting')) setTimeout(() => { void processQueue() }, 1000)
  } catch (e) {
    console.warn('[download] load failed', String(e))
  }
}

const getTask = (id: string) => tasks.find(t => t.id === id)

const updateTask = (id: string, patch: Partial<DownloadTask>) => {
  tasks = tasks.map(t => t.id === id ? { ...t, ...patch } : t)
  notify()
}

const generateId = (musicInfo: LX.Music.MusicInfoOnline) => {
  return `${musicInfo.source}_${musicInfo.id}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

/** 文件名安全化，且保证扩展名不被截断 */
const buildFilename = (musicInfo: LX.Music.MusicInfoOnline, ext: string) => {
  const artist = musicInfo.singer || '未知艺术家'
  const title = musicInfo.name || '未知歌曲'
  const idHash = String(musicInfo.id ?? '').replace(/[^a-zA-Z0-9]/g, '').slice(-6)
  const suffix = ` [${musicInfo.source}${idHash ? '-' + idHash : ''}].${ext}`
  const base = `${artist} - ${title}`
    .replace(/[\\/:*?"<>|\r\n]/g, '_')
    .slice(0, Math.max(1, NAME_MAX_LEN - suffix.length))
  return base + suffix
}

/** 同 source+id 且处于"有效"状态的任务（用于去重，避免并发写同一文件） */
const findDuplicate = (musicInfo: LX.Music.MusicInfoOnline) => {
  return tasks.find(t => t.musicInfo.source === musicInfo.source &&
    t.musicInfo.id === musicInfo.id &&
    t.status !== 'failed' && t.status !== 'cancelled')
}

/** 读取文件头判断真实音频格式（源可能返回错误页或与扩展名不符的内容） */
const sniffAudioExt = async(path: string): Promise<string | null> => {
  const head = await RNFS.read(path, 12, 0, 'base64').catch(() => '')
  if (!head) return null
  let b: Buffer
  try {
    b = Buffer.from(head, 'base64')
  } catch {
    return null
  }
  if (b.length < 8) return null
  const ascii = (start: number, count: number) => b.subarray(start, start + count).toString('ascii')
  if (ascii(0, 4) == 'fLaC') return 'flac'
  if (ascii(0, 3) == 'ID3') return 'mp3'
  if (ascii(0, 4) == 'RIFF' && ascii(8, 4) == 'WAVE') return 'wav'
  if (ascii(0, 4) == 'OggS') return 'ogg'
  if (ascii(4, 4) == 'ftyp') return 'm4a'
  if (ascii(0, 4) == 'FORM' && ['AIFF', 'AIFC'].includes(ascii(8, 4))) return 'aiff'
  if (ascii(0, 4) == 'MAC ') return 'ape'
  if (b[0] == 0xff && (b[1] & 0xf6) == 0xf0) return 'aac'
  if (b[0] == 0xff && (b[1] & 0xe0) == 0xe0) return 'mp3'
  return null
}

class InvalidUrlError extends Error {}

/** 复刻播放器取链逻辑，取下载直链（带单次 429 退避与一次普通重试） */
const getMusicDownloadUrl = async(
  musicInfo: LX.Music.MusicInfoOnline,
  isRefresh = true,
  isRetryed = false,
  quality?: LX.Quality,
): Promise<{ url: string, quality: LX.Quality | null }> => {
  const toggleMusicInfo = musicInfo.meta.toggleMusicInfo

  const request = async(info: LX.Music.MusicInfoOnline, allowToggleSource: boolean) => getMusicUrlInfo({
    musicInfo: info,
    quality,
    isRefresh,
    allowToggleSource,
  })

  const firstTry = toggleMusicInfo
    ? request(toggleMusicInfo, false).catch(async() => request(musicInfo, true))
    : request(musicInfo, true)

  return firstTry.catch(async(err: any) => {
    const message = err instanceof Error ? err.message : String(err)
    if (!isRetryed && message == requestMsg.tooManyRequests) {
      await new Promise(resolve => { setTimeout(resolve, (2 + Math.random() * 4) * 1000) })
      return getMusicDownloadUrl(musicInfo, isRefresh, true, quality)
    }
    if (!isRetryed) return getMusicDownloadUrl(musicInfo, isRefresh, true, quality)
    throw err
  })
}

/** 取链 + 超时；超时后置 token.aborted，阻止内部递归重试继续跑 */
const getUrlWithTimeout = async(
  musicInfo: LX.Music.MusicInfoOnline,
  quality: LX.Quality | undefined,
  token: { aborted: boolean },
): Promise<{ url: string, quality: LX.Quality | null }> => {
  let timer: ReturnType<typeof setTimeout> | null = null
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      token.aborted = true
      reject(new Error('获取链接超时'))
    }, URL_TIMEOUT)
  })
  try {
    return await Promise.race([getMusicDownloadUrl(musicInfo, true, false, quality), timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

const scheduleProcessQueue = (delay: number) => {
  if (retryTimer) clearTimeout(retryTimer)
  retryTimer = setTimeout(() => { retryTimer = null; void processQueue() }, delay)
}

const processQueue = async() => {
  if (isProcessing) return
  isProcessing = true
  try {
    while (true) {
      const activeCount = tasks.filter(t => t.status === 'downloading' || t.status === 'preparing').length
      if (activeCount >= MAX_CONCURRENT) break

      const now = Date.now()
      const waiting = tasks.filter(t => t.status === 'waiting')
      if (!waiting.length) break

      const ready = waiting.find(t => !t.nextRetryAt || t.nextRetryAt <= now)
      if (!ready) {
        // 全部处于退避等待：等最早的一个到期再继续，避免空转
        const next = Math.min(...waiting.map(t => t.nextRetryAt ?? now))
        scheduleProcessQueue(Math.max(200, next - now))
        break
      }
      await startDownload(ready)
    }
  } finally {
    isProcessing = false
  }
}

const startDownload = async(task: DownloadTask) => {
  const fresh = getTask(task.id)
  if (!fresh || fresh.status !== 'waiting') return

  const token = { aborted: false }
  updateTask(task.id, { status: 'preparing', errorMessage: undefined, nextRetryAt: undefined })

  try {
    const result = await getUrlWithTimeout(task.musicInfo, task.quality, token)

    if (token.aborted || cancelledTasks.has(task.id)) {
      cancelledTasks.delete(task.id)
      return
    }
    if (!result?.url) throw new InvalidUrlError('无法获取下载链接')
    // 安全：下载地址必须为 http(s)，避免自定义源返回异常 scheme
    if (!/^https?:\/\//i.test(result.url)) throw new InvalidUrlError('无效的下载地址')

    const quality = result.quality ?? task.quality ?? DEFAULT_QUALITY
    const ext = EXT_BY_URL.find(([rx]) => rx.test(result.url))?.[1] ?? 'mp3'
    const filename = buildFilename(task.musicInfo, ext)
    const localPath = `${DOWNLOAD_DIR}/${filename}`

    await ensureDir()
    updateTask(task.id, { status: 'downloading', quality, progress: 0 })

    const headers: Record<string, string> = { 'User-Agent': UA }
    if (REFERER_MAP[task.musicInfo.source]) headers.Referer = REFERER_MAP[task.musicInfo.source]

    const job = RNFS.downloadFile({
      fromUrl: result.url,
      toFile: localPath,
      headers,
      progressDivider: 10,
      progress: (res) => {
        const currentTask = getTask(task.id)
        if (!currentTask || currentTask.status !== 'downloading') return
        const progress = res.contentLength > 0 ? res.bytesWritten / res.contentLength : 0
        updateTask(task.id, {
          progress,
          downloadedBytes: res.bytesWritten,
          totalBytes: res.contentLength,
        })
      },
    })
    activeDownloads.set(task.id, { jobId: job.jobId })

    let downloaded: { statusCode: number } | null = null
    let abortReject: (e: Error) => void = () => {}
    const abortPromise = new Promise<never>((_resolve, reject) => { abortReject = reject })
    abortControllers.set(task.id, { reject: abortReject })
    let settleTimer: ReturnType<typeof setTimeout> | null = null
    const settleFallback = new Promise<never>((_resolve, reject) => {
      settleTimer = setTimeout(() => { reject(new Error('下载进程无响应，已超时放弃')) }, DOWNLOAD_SETTLE_TIMEOUT)
    })
    try {
      downloaded = await Promise.race([job.promise, abortPromise, settleFallback])
    } catch (e) {
      if (cancelledTasks.has(task.id)) {
        cancelledTasks.delete(task.id)
        return
      }
      throw e
    } finally {
      if (settleTimer) clearTimeout(settleTimer)
      abortControllers.delete(task.id)
    }

    if (cancelledTasks.has(task.id)) {
      cancelledTasks.delete(task.id)
      return
    }

    const statusCode = downloaded?.statusCode ?? 0
    if (statusCode !== 200 && statusCode !== 206) {
      if (statusCode === 403) throw new Error('下载被禁止(403)，可能需要登录或有防盗链')
      if (statusCode === 404) throw new Error('文件不存在(404)')
      throw new Error(`下载失败，状态码: ${statusCode || '未知'}`)
    }

    // 校验真实音频格式：源可能返回 HTML/JSON 错误页（扩展名对但内容不对 → 播放永久缓冲）
    const realExt = await sniffAudioExt(localPath)
    if (!realExt || realExt === 'ape') {
      await RNFS.unlink(localPath).catch(() => {})
      throw new Error(realExt === 'ape'
        ? 'APE 格式无法在 iOS 播放，请换其它音质下载'
        : '下载内容不是有效音频（可能被防盗链拦截），已删除，请重试或换音质')
    }
    let finalPath = localPath
    if (realExt !== ext) {
      // 内容与扩展名不一致时以真实格式为准重命名，避免播放器按错误容器解析
      finalPath = `${DOWNLOAD_DIR}/${buildFilename(task.musicInfo, realExt)}`
      await RNFS.moveFile(localPath, finalPath).catch(() => { finalPath = localPath })
    }
    const basePath = finalPath.replace(/\.[^.]+$/, '')

    // 歌词/封面：带超时，失败不影响下载结果
    const lyric = await withTimeout(
      getLyricInfo({ musicInfo: task.musicInfo, isRefresh: true }).then(info => info?.lyric ?? null),
      LYRIC_TIMEOUT,
      null,
    )
    if (lyric) {
      await RNFS.writeFile(basePath + '.lrc', lyric, 'utf8').catch(() => {})
    }

    const picUrl = await withTimeout(
      getPicUrl({ musicInfo: task.musicInfo, isRefresh: true }).catch(() => ''),
      LYRIC_TIMEOUT,
      '',
    )
    if (picUrl && /^https?:\/\//i.test(picUrl)) {
      const picExt = /\.png(\?|$)/i.test(picUrl) ? '.png' : '.jpg'
      const picJob = RNFS.downloadFile({
        fromUrl: picUrl,
        toFile: basePath + picExt,
        headers: { 'User-Agent': UA },
      })
      await withTimeout(picJob.promise, PIC_TIMEOUT, null)
    }

    registerLocalDownload(task.musicInfo, finalPath, quality)

    updateTask(task.id, {
      status: 'completed',
      progress: 1,
      localPath: finalPath,
      completedAt: Date.now(),
      speed: 0,
      errorMessage: undefined,
      nextRetryAt: undefined,
    })
  } catch (error) {
    if (cancelledTasks.has(task.id)) {
      cancelledTasks.delete(task.id)
      return
    }

    const rawMsg = error instanceof Error ? error.message : String(error)
    const currentTask = getTask(task.id)
    const retryable = currentTask && currentTask.retryCount < MAX_RETRY &&
      !(error instanceof InvalidUrlError) &&
      !rawMsg.includes('超时') &&
      !rawMsg.includes('无响应')

    if (currentTask && retryable) {
      const nextRetry = currentTask.retryCount + 1
      const delay = Math.min(RETRY_MAX_DELAY, RETRY_BASE_DELAY * Math.pow(2, currentTask.retryCount))
      updateTask(task.id, {
        status: 'waiting',
        retryCount: nextRetry,
        nextRetryAt: Date.now() + delay,
        errorMessage: `${rawMsg}（${Math.round(delay / 1000)} 秒后第 ${nextRetry}/${MAX_RETRY} 次重试）`,
        speed: 0,
      })
      // 移到队尾，避免反复失败的任务阻塞其它任务
      const moved = tasks.filter(t => t.id !== task.id)
      const self = tasks.find(t => t.id === task.id)
      if (self) tasks = [...moved, self]
    } else {
      updateTask(task.id, {
        status: 'failed',
        errorMessage: rawMsg,
        speed: 0,
      })
    }
  } finally {
    activeDownloads.delete(task.id)
    abortControllers.delete(task.id)
    scheduleProcessQueue(300)
  }
}

/** 新建任务；返回 null 表示已存在同歌任务（调用方据此提示） */
export const addDownload = (musicInfo: LX.Music.MusicInfoOnline, quality?: LX.Quality): string | null => {
  if (findDuplicate(musicInfo)) return null
  const task: DownloadTask = {
    id: generateId(musicInfo),
    musicInfo,
    status: 'waiting',
    progress: 0,
    downloadedBytes: 0,
    totalBytes: 0,
    speed: 0,
    quality,
    createdAt: Date.now(),
    retryCount: 0,
  }
  tasks = [...tasks, task]
  notify()
  void processQueue()
  return task.id
}

/** 批量新建；全部重复时返回 null */
export const addDownloads = (musicInfos: LX.Music.MusicInfoOnline[], quality?: LX.Quality): string[] | null => {
  const added: DownloadTask[] = []
  for (const info of musicInfos) {
    const duplicated = findDuplicate(info) != null ||
      added.some(t => t.musicInfo.source === info.source && t.musicInfo.id === info.id)
    if (duplicated) continue
    added.push({
      id: generateId(info),
      musicInfo: info,
      status: 'waiting',
      progress: 0,
      downloadedBytes: 0,
      totalBytes: 0,
      speed: 0,
      quality,
      createdAt: Date.now(),
      retryCount: 0,
    })
  }
  if (!added.length) return null
  tasks = [...tasks, ...added]
  notify()
  void processQueue()
  return added.map(t => t.id)
}

const stopActiveJob = (taskId: string, reason: string) => {
  const active = activeDownloads.get(taskId)
  if (active) {
    try {
      RNFS.stopDownload(active.jobId)
    } catch {
      // 底层任务可能已结束，忽略
    }
    activeDownloads.delete(taskId)
  }
  abortControllers.get(taskId)?.reject(new Error(reason))
}

export const pauseTask = (taskId: string) => {
  const task = getTask(taskId)
  if (!task || task.status === 'completed' || task.status === 'failed') return
  if (task.status === 'downloading' || task.status === 'preparing') {
    cancelledTasks.add(taskId)
    stopActiveJob(taskId, 'task stopped')
  }
  updateTask(taskId, { status: 'paused', speed: 0, nextRetryAt: undefined })
}

export const resumeTask = (taskId: string) => {
  const task = getTask(taskId)
  if (!task || task.status !== 'paused') return
  cancelledTasks.delete(taskId)
  updateTask(taskId, { status: 'waiting', retryCount: 0, nextRetryAt: undefined, errorMessage: undefined })
  void processQueue()
}

export const removeTask = (taskId: string, deleteFile = false) => {
  const task = getTask(taskId)
  if (!task) return
  if (task.status === 'downloading' || task.status === 'preparing') {
    stopActiveJob(taskId, 'task removed')
  }
  cancelledTasks.delete(taskId)

  if (deleteFile && task.localPath) {
    const localPath = task.localPath
    const base = localPath.replace(/\.[^.]+$/, '')
    void RNFS.unlink(localPath).catch(() => {})
    void RNFS.unlink(base + '.lrc').catch(() => {})
    void RNFS.unlink(base + '.jpg').catch(() => {})
    void RNFS.unlink(base + '.png').catch(() => {})
    unregisterLocalDownload(localPath)
  }

  tasks = tasks.filter(t => t.id !== taskId)
  notify()
  scheduleProcessQueue(100)
}

export const retryTask = (taskId: string) => {
  const task = getTask(taskId)
  if (!task || task.status !== 'failed') return
  updateTask(taskId, { status: 'waiting', errorMessage: undefined, retryCount: 0, nextRetryAt: undefined })
  void processQueue()
}

export const pauseAll = () => {
  tasks.forEach(t => { pauseTask(t.id) })
}

export const resumeAll = () => {
  tasks.forEach(t => {
    if (t.status === 'paused') {
      cancelledTasks.delete(t.id)
      updateTask(t.id, { status: 'waiting', retryCount: 0, nextRetryAt: undefined })
    }
  })
  void processQueue()
}

export const clearCompleted = () => {
  tasks = tasks.filter(t => t.status !== 'completed')
  notify()
}

export const getTasks = () => [...tasks]

export const subscribe = (listener: TaskListener) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export const getDownloadDir = () => DOWNLOAD_DIR

/** 已下载标识（来自本地索引，清空下载记录后徽标仍准确） */
export const getDownloadedIdSet = (): Set<string> => getLocalDownloadedIdSet()

export default {
  addDownload,
  addDownloads,
  pauseTask,
  resumeTask,
  removeTask,
  retryTask,
  pauseAll,
  resumeAll,
  clearCompleted,
  getTasks,
  subscribe,
  getDownloadDir,
  getDownloadedIdSet,
}
