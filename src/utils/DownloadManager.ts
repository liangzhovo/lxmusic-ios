/**
 * 下载管理器 - 改进版
 * 复用播放器的链接获取逻辑，顺序下载避免限流
 */
import RNFS from 'react-native-fs'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { getMusicUrlInfo, getLyricInfo, getPicUrl } from '@/core/music/online'
import { requestMsg } from '@/utils/message'
import { clearCompletedFiles, recordCompleted, removeCompletedFile } from './downloadLocal'

const STORAGE_KEY = 'lx_music_download_tasks'

export type DownloadStatus = 'waiting' | 'preparing' | 'downloading' | 'paused' | 'completed' | 'failed' | 'cancelled'

export interface DownloadTask {
  id: string
  musicInfo: LX.Music.MusicInfoOnline
  status: DownloadStatus
  progress: number
  downloadedBytes: number
  totalBytes: number
  speed: number
  errorMessage?: string
  localPath?: string
  createdAt: number
  completedAt?: number
  retryCount: number
}

type TaskListener = (tasks: DownloadTask[]) => void

const DOWNLOAD_DIR = RNFS.DocumentDirectoryPath + '/lx-music-downloads'
const MAX_CONCURRENT = 1
const MAX_RETRY = 3
const URL_TIMEOUT = 30000

let tasks: DownloadTask[] = []
const listeners = new Set<TaskListener>()
const activeDownloads = new Map<string, { job: any, cancelled: boolean }>()
const cancelledTasks = new Set<string>()
// iOS: RNFS job.stop() may leave job.promise pending forever (no resolve/reject
// when the server supports range requests). Keep an abort handle per task so
// pause/remove can release the pending await immediately, plus a hard settle
// timeout as a last resort. Without this, the queue deadlocks on iOS.
const abortControllers = new Map<string, { reject: (e: Error) => void }>()
const DOWNLOAD_SETTLE_TIMEOUT = 10 * 60 * 1000
let isProcessing = false

const ensureDir = async() => {
  try {
    const exists = await RNFS.exists(DOWNLOAD_DIR)
    if (!exists) await RNFS.mkdir(DOWNLOAD_DIR)
  } catch (e) {
    console.error('创建下载目录失败', e)
  }
}

const notify = () => {
  listeners.forEach(l => { l([...tasks]) })
  saveTasks()
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
const saveTasks = () => {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      // 只保存必要信息，不保存临时状态
      const tasksToSave = tasks.map(t => ({
        ...t,
        status: (t.status === 'downloading' || t.status === 'preparing') ? 'waiting' : t.status,
      }))
      void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(tasksToSave))
    } catch (e) {
      console.log('save download tasks failed:', e)
    }
  }, 500)
}

export const loadTasks = async() => {
  try {
    const data = await AsyncStorage.getItem(STORAGE_KEY)
    if (data) {
      const loaded = JSON.parse(data)
      tasks = loaded.map((t: DownloadTask) => ({
        ...t,
        status: (t.status === 'downloading' || t.status === 'preparing') ? 'waiting' : t.status,
      }))
      // 重建已下载文件注册表（供播放本地优先）
      for (const t of tasks) {
        if (t.status === 'completed' && t.localPath) recordCompleted(t.musicInfo, t.localPath)
      }
      notify()
      // 恢复等待中的任务
      const waitingTasks = tasks.filter(t => t.status === 'waiting')
      if (waitingTasks.length) {
        setTimeout(async() => processQueue(), 1000)
      }
    }
  } catch (e) {
    console.log('load download tasks failed:', e)
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

const sanitizeFilename = (name: string) => {
  return name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 100)
}

// 完全复刻播放器的 getMusicPlayUrl 逻辑，直接用 isRefresh=true 确保获取最新链接
const getMusicDownloadUrl = async(
  musicInfo: LX.Music.MusicInfoOnline,
  isRefresh = true,
  isRetryed = false,
): Promise<{ url: string, quality: LX.Quality | null }> => {
  const toggleMusicInfo = musicInfo.meta.toggleMusicInfo

  // 第一步：先尝试 toggleMusicInfo（不切换音源）
  const firstTry = toggleMusicInfo
    ? getMusicUrlInfo({
      musicInfo: toggleMusicInfo,
      isRefresh,
      allowToggleSource: false,
    }).catch(async() => {
      // 失败后用原信息，允许切换音源
      return getMusicUrlInfo({
        musicInfo,
        isRefresh,
        allowToggleSource: true,
        onToggleSource() {
          console.log('download: toggle source try')
        },
      })
    })
    : getMusicUrlInfo({
      musicInfo,
      isRefresh,
      allowToggleSource: true,
      onToggleSource() {
        console.log('download: toggle source try')
      },
    })

  return firstTry.catch(async(err: any) => {
    // tooManyRequests 延迟2-6秒重试（仅一次，防止无限递归）
    if (!isRetryed && err.message == requestMsg.tooManyRequests) {
      const time = 2 + Math.random() * 4
      await new Promise(resolve => setTimeout(resolve, time * 1000))
      return getMusicDownloadUrl(musicInfo, isRefresh, true)
    }

    // 第一次失败，再试一次
    if (!isRetryed) {
      return getMusicDownloadUrl(musicInfo, isRefresh, true)
    }

    // 第二次失败，如果不是刷新模式，用 isRefresh=true 再试一次
    if (!isRefresh) {
      return getMusicDownloadUrl(musicInfo, true, true)
    }

    throw err
  })
}

const getUrlWithTimeout = async(musicInfo: LX.Music.MusicInfoOnline): Promise<{ url: string, quality: LX.Quality | null }> => {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('获取链接超时'))
    }, URL_TIMEOUT)

    getMusicDownloadUrl(musicInfo).then(result => {
      clearTimeout(timeout)
      resolve(result)
    }).catch(err => {
      clearTimeout(timeout)
      reject(err)
    })
  })
}

const processQueue = async() => {
  if (isProcessing) return
  isProcessing = true

  try {
    while (true) {
      const activeCount = tasks.filter(t => t.status === 'downloading' || t.status === 'preparing').length
      if (activeCount >= MAX_CONCURRENT) break

      const waitingTask = tasks.find(t => t.status === 'waiting')
      if (!waitingTask) break

      await startDownload(waitingTask)
    }
  } finally {
    isProcessing = false
  }
}

const startDownload = async(task: DownloadTask) => {
  if (cancelledTasks.has(task.id)) {
    cancelledTasks.delete(task.id)
    return
  }

  updateTask(task.id, { status: 'preparing' })

  try {
    const result = await getUrlWithTimeout(task.musicInfo)

    if (cancelledTasks.has(task.id)) {
      cancelledTasks.delete(task.id)
      return
    }

    if (!result?.url) {
      throw new Error('无法获取下载链接')
    }

    if (result.url.includes('fake')) {
      throw new Error('无效的下载链接')
    }

    await ensureDir()

    const artist = task.musicInfo.singer || '未知艺术家'
    const title = task.musicInfo.name || '未知歌曲'
    const ext = result.url.includes('.flac') ? 'flac' : result.url.includes('.ape') ? 'ape' : result.url.includes('.m4a') ? 'm4a' : 'mp3'
    // 文件名加入源+歌曲id摘要，避免同名任务（不同音质/重复下载）互相覆盖
    const idHash = String(task.musicInfo.id ?? '').replace(/[^a-zA-Z0-9]/g, '').slice(-6)
    const filename = sanitizeFilename(`${artist} - ${title} [${task.musicInfo.source}${idHash ? '-' + idHash : ''}].${ext}`)
    const localPath = `${DOWNLOAD_DIR}/${filename}`

    updateTask(task.id, { status: 'downloading' })

    const headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
    }

    const source = task.musicInfo.source
    const refererMap: Record<string, string> = {
      kw: 'https://www.kuwo.cn/',
      kg: 'https://www.kugou.com/',
      tx: 'https://y.qq.com/',
      wy: 'https://music.163.com/',
      mg: 'https://music.migu.cn/',
    }
    if (refererMap[source]) {
      headers.Referer = refererMap[source]
    }

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

    activeDownloads.set(task.id, { job, cancelled: false })

    let result2 = null as null | { statusCode: number }
    try {
      // iOS: job.stop() may leave job.promise pending forever; race it against
      // an abort handle (released by pause/remove) and a hard settle timeout.
      let abortReject: (e: Error) => void = () => {}
      const abortPromise = new Promise<never>((_resolve, reject) => { abortReject = reject })
      abortControllers.set(task.id, { reject: abortReject })
      let settleTimer: ReturnType<typeof setTimeout> | null = null
      const settleFallback = new Promise<never>((_resolve, reject) => {
        settleTimer = setTimeout(() => { reject(new Error('下载进程无响应，已超时放弃')) }, DOWNLOAD_SETTLE_TIMEOUT)
      })
      try {
        result2 = await Promise.race([job.promise, abortPromise, settleFallback])
      } finally {
        if (settleTimer) clearTimeout(settleTimer)
      }
    } catch (e) {
      // stopped by pause/remove, or settle timeout: release the queue cleanly
      if (cancelledTasks.has(task.id)) {
        cancelledTasks.delete(task.id)
        return
      }
      throw e
    }

    if (cancelledTasks.has(task.id)) {
      cancelledTasks.delete(task.id)
      activeDownloads.delete(task.id)
      return
    }

    if (result2 && (result2.statusCode === 200 || result2.statusCode === 206)) {
      // 下载完成后保存歌词和封面
      const basePath = localPath.replace(/\.[^.]+$/, '')

      // 保存歌词
      try {
        const lyricInfo = await getLyricInfo({ musicInfo: task.musicInfo, isRefresh: true })
        if (lyricInfo?.lyric) {
          await RNFS.writeFile(basePath + '.lrc', lyricInfo.lyric, 'utf8')
        }
      } catch (e) {
        console.log('download lyric failed:', e)
      }

      // 保存封面
      try {
        const picUrl = await getPicUrl({ musicInfo: task.musicInfo, isRefresh: true })
        if (picUrl && picUrl.startsWith('http')) {
          const picExt = picUrl.includes('.png') ? '.png' : '.jpg'
          const picJob = RNFS.downloadFile({
            fromUrl: picUrl,
            toFile: basePath + picExt,
            headers: {
              'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
            },
          })
          await picJob.promise
        }
      } catch (e) {
        console.log('download pic failed:', e)
      }

      updateTask(task.id, {
        status: 'completed',
        progress: 1,
        localPath,
        completedAt: Date.now(),
        speed: 0,
      })
      recordCompleted(task.musicInfo, localPath)
    } else if (result2 && result2.statusCode === 403) {
      throw new Error('下载被禁止(403)，可能需要登录或有防盗链')
    } else if (result2 && result2.statusCode === 404) {
      throw new Error('文件不存在(404)')
    } else {
      throw new Error(`下载失败，状态码: ${result2?.statusCode ?? '未知'}`)
    }
  } catch (error) {
    if (cancelledTasks.has(task.id)) {
      cancelledTasks.delete(task.id)
      return
    }

    const msg = error instanceof Error ? error.message : String(error)
    const currentTask = getTask(task.id)

    if (currentTask && currentTask.retryCount < MAX_RETRY && !msg.includes('超时')) {
      updateTask(task.id, {
        status: 'waiting',
        retryCount: currentTask.retryCount + 1,
        errorMessage: `${msg} (重试中 ${currentTask.retryCount + 1}/${MAX_RETRY})`,
      })
      // move retrying task to the tail so it does not starve the rest of the queue
      const moved = tasks.filter(t => t.id !== task.id)
      const self = tasks.find(t => t.id === task.id)
      if (self) tasks = [...moved, self]
    } else {
      updateTask(task.id, {
        status: 'failed',
        errorMessage: msg,
        speed: 0,
      })
    }
  } finally {
    activeDownloads.delete(task.id)
    abortControllers.delete(task.id)
    setTimeout(async() => processQueue(), 500)
  }
}

export const addDownload = (musicInfo: LX.Music.MusicInfoOnline) => {
  const task: DownloadTask = {
    id: generateId(musicInfo),
    musicInfo,
    status: 'waiting',
    progress: 0,
    downloadedBytes: 0,
    totalBytes: 0,
    speed: 0,
    createdAt: Date.now(),
    retryCount: 0,
  }
  tasks = [...tasks, task]
  notify()
  void processQueue()
  return task.id
}

export const addDownloads = (musicInfos: LX.Music.MusicInfoOnline[]) => {
  const newTasks: DownloadTask[] = musicInfos.map(info => ({
    id: generateId(info),
    musicInfo: info,
    status: 'waiting',
    progress: 0,
    downloadedBytes: 0,
    totalBytes: 0,
    speed: 0,
    createdAt: Date.now(),
    retryCount: 0,
  }))
  tasks = [...tasks, ...newTasks]
  notify()
  void processQueue()
  return newTasks.map(t => t.id)
}

export const pauseTask = (taskId: string) => {
  const task = getTask(taskId)
  if (!task) return
  if (task.status === 'downloading' || task.status === 'preparing') {
    const active = activeDownloads.get(taskId)
    if (active) {
      active.job.stop()
      activeDownloads.delete(taskId)
    }
    // release the pending await so the queue does not deadlock on iOS
    abortControllers.get(taskId)?.reject(new Error('task stopped'))
  }
  cancelledTasks.add(taskId)
  updateTask(taskId, { status: 'paused', speed: 0 })
}

export const resumeTask = (taskId: string) => {
  const task = getTask(taskId)
  if (!task || task.status !== 'paused') return
  cancelledTasks.delete(taskId)
  updateTask(taskId, { status: 'waiting', retryCount: 0 })
  void processQueue()
}

export const removeTask = (taskId: string, deleteFile = false) => {
  const task = getTask(taskId)
  if (task) {
    if (task.status === 'downloading' || task.status === 'preparing') {
      const active = activeDownloads.get(taskId)
      if (active) active.job.stop()
      activeDownloads.delete(taskId)
      // release the pending await so the queue does not deadlock on iOS
      abortControllers.get(taskId)?.reject(new Error('task removed'))
      cancelledTasks.add(taskId)
    }
    if (deleteFile && task.localPath) {
      RNFS.unlink(task.localPath).catch(() => {
        // also remove related files (lyric/cover)
        const base = task.localPath!.replace(/\.[^.]+$/, '')
        RNFS.unlink(base + '.lrc').catch(() => {})
        RNFS.unlink(base + '.jpg').catch(() => {})
        RNFS.unlink(base + '.png').catch(() => {})
      })
      removeCompletedFile(task.localPath)
    }
  }
  tasks = tasks.filter(t => t.id !== taskId)
  notify()
  setTimeout(async() => processQueue(), 100)
}

export const retryTask = (taskId: string) => {
  const task = getTask(taskId)
  if (!task || task.status !== 'failed') return
  updateTask(taskId, { status: 'waiting', errorMessage: undefined, retryCount: 0 })
  void processQueue()
}

export const pauseAll = () => {
  tasks.forEach(t => {
    if (t.status === 'downloading' || t.status === 'preparing' || t.status === 'waiting') {
      pauseTask(t.id)
    }
  })
}

export const resumeAll = () => {
  tasks.forEach(t => {
    if (t.status === 'paused') {
      cancelledTasks.delete(t.id)
      updateTask(t.id, { status: 'waiting', retryCount: 0 })
    }
  })
  void processQueue()
}

export const clearCompleted = () => {
  tasks = tasks.filter(t => t.status !== 'completed')
  clearCompletedFiles()
  notify()
}

export const getTasks = () => [...tasks]

export const subscribe = (listener: TaskListener) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const getDownloadDir = () => DOWNLOAD_DIR

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
}

/** 已下载（completed）歌曲标识映射（id 与 source|name|singer 双索引），供列表显示"已下载"标识 */
export const getDownloadedIdSet = (): Set<string> => {
  const set = new Set<string>()
  for (const t of tasks) {
    if (t.status !== 'completed') continue
    set.add(t.musicInfo.id)
    set.add(`${t.musicInfo.source}|${t.musicInfo.name}|${t.musicInfo.singer}`)
  }
  return set
}
