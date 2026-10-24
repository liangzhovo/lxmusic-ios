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

/**
 * 查询歌曲本地已下载文件路径（供播放优先本地使用）
 * 优先精确 id 匹配，其次 source+name+singer 兜底（列表转在线信息后 id 可能不同）
 */
export const getDownloadedFilePath = async(musicInfo: LX.Music.MusicInfoOnline): Promise<string | null> => {
  const match = (f: CompletedFile) => (
    f.musicInfo.id === musicInfo.id ||
    (f.musicInfo.source === musicInfo.source && f.musicInfo.name === musicInfo.name && f.musicInfo.singer === musicInfo.singer)
  )
  const file = completedFiles.find(match)
  if (!file) return null
  const exists = await RNFS.exists(file.localPath)
  return exists ? `file://${file.localPath}` : null
}
