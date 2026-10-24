/**
 * 已下载文件注册表（独立模块，避免 online <-> DownloadManager 循环/动态 import 问题）
 * DownloadManager 在完成/恢复/删除时维护 completed 文件列表；
 * 播放链路（core/music/online）静态引用本模块查询本地文件，实现"本地优先播放"。
 */
import RNFS from 'react-native-fs'

export interface CompletedFile {
  musicInfo: LX.Music.MusicInfoOnline
  localPath: string
}

let completedFiles: CompletedFile[] = []

export const recordCompleted = (musicInfo: LX.Music.MusicInfoOnline, localPath: string) => {
  completedFiles = completedFiles.filter(f => f.localPath !== localPath)
  completedFiles.push({ musicInfo, localPath })
}

export const removeCompletedFile = (localPath: string) => {
  completedFiles = completedFiles.filter(f => f.localPath !== localPath)
}

export const clearCompletedFiles = () => {
  completedFiles = []
}

export const getCompletedFiles = (): CompletedFile[] => [...completedFiles]

/** 归一化文本（用于宽松匹配：去空白、忽略大小写） */
const norm = (s?: string | null) => String(s ?? '').replace(/\s+/g, '').toLowerCase()

/** 匹配已下载文件（id 均非空才比较；name+singer 归一化兜底，忽略音源差异） */
const findCompletedFile = (musicInfo: { id?: string, source?: string, name?: string, singer?: string }) => {
  return completedFiles.find(f => {
    if (f.musicInfo.id && musicInfo.id && f.musicInfo.id === musicInfo.id) return true
    return norm(f.musicInfo.name) === norm(musicInfo.name) &&
      norm(f.musicInfo.singer) === norm(musicInfo.singer)
  })
}

/**
 * 查询歌曲本地已下载文件路径（供播放优先本地使用）
 */
export const getDownloadedFilePath = async(musicInfo: { id?: string, source?: string, name?: string, singer?: string }): Promise<string | null> => {
  const file = findCompletedFile(musicInfo)
  if (!file) return null
  const exists = await RNFS.exists(file.localPath)
  return exists ? `file://${file.localPath}` : null
}

/** 查询歌曲本地已下载歌词文本（无网络时播放仍可显示歌词） */
export const getLocalLyricText = async(musicInfo: { id?: string, name?: string, singer?: string }): Promise<string | null> => {
  const file = findCompletedFile(musicInfo)
  if (!file) return null
  const base = file.localPath.replace(/\.[^.]+$/, '')
  const lrcPath = base + '.lrc'
  if (await RNFS.exists(lrcPath)) return RNFS.readFile(lrcPath, 'utf8')
  return null
}

/** 查询歌曲本地已下载封面路径（无网络时播放仍可显示封面） */
export const getLocalPicPath = async(musicInfo: { id?: string, name?: string, singer?: string }): Promise<string | null> => {
  const file = findCompletedFile(musicInfo)
  if (!file) return null
  const base = file.localPath.replace(/\.[^.]+$/, '')
  for (const ext of ['.jpg', '.png']) {
    const picPath = base + ext
    if (await RNFS.exists(picPath)) return `file://${picPath}`
  }
  return null
}
