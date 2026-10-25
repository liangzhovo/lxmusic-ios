import { AppState } from 'react-native'
import { useEffect, useState } from 'react'
import { DownloadQueue } from './DownloadQueue'
import { available, nativeCommand, observeProgress, operationId, cancelOperation } from './native'
import { entryMusic, getLibraryReference, publishedMusic } from './reference'
import type { BackupFile, Destination, DirectoryEntry, LibraryAccount, LibraryConfig, LibraryReference, PublishedFile, RestoreStatus, TransferProgress, TransferSource } from './types'
import { getMusicUrlInfo } from '@/core/music'
import { addListMusics, getUserLists } from '@/core/list'
import { openLibraryPage } from './page'
import { withStorageSnapshot } from '@/plugins/storage'

export const downloadQueue = new DownloadQueue({
  read: () => nativeCommand('queue.read'),
  save: async(state) => { await nativeCommand('queue.save', { json: JSON.stringify(state) }) },
  resolve: async(job): Promise<TransferSource> => {
    const ref = getLibraryReference(job.music)
    if (ref?.kind === 'webdav') return ref
    if (ref?.kind === 'local') return { kind: 'local', path: await nativeCommand<string>('file.local', { path: ref.path }) }
    if (job.music.source === 'local') return { kind: 'local', path: job.music.meta.filePath }
    const { url } = await getMusicUrlInfo({ musicInfo: job.music, quality: job.quality, isRefresh: true, allowToggleSource: false, cacheAudio: false })
    if (!/^https?:\/\//i.test(url)) throw new Error('音源未提供可下载的HTTP地址')
    return { kind: 'url', url }
  },
  execute: (job, source, id) => nativeCommand<PublishedFile>('download.run', { operationId: id, jobId: job.id, source, name: `${job.music.name}${job.music.singer ? ' - ' + job.music.singer : ''}`, destination: job.destination }),
  cancel: cancelOperation,
  discardPartial: async(jobId) => { await nativeCommand('download.discardPartial', { jobId }) },
  id: operationId, now: Date.now,
})

let initializePromise: Promise<void> | undefined
let libraryError = ''
let configuration: LibraryConfig = { schema: 1, accounts: [], audioLimitMB: 512 }
const listeners = new Set<() => void>()
const refreshUI = () => { for (const listener of listeners) listener() }
const progresses = new Map<string, (event: TransferProgress) => void>()
let exclusiveUI = false
export const librarySnapshot = () => ({ configuration, error: libraryError, busy: exclusiveUI })
export function initializeLibrary() {
  if (!available()) return Promise.resolve()
  initializePromise ??= (async() => {
    observeProgress(event => { downloadQueue.progress(event); progresses.get(event.operationId)?.(event) })
    configuration = await nativeCommand<LibraryConfig>('config.read')
    downloadQueue.subscribe(() => { global.lx.libraryDownloadsEnabled = downloadQueue.snapshot().enabled })
    await downloadQueue.initialize()
    global.lx.libraryDownloadsEnabled = downloadQueue.snapshot().enabled
    AppState.addEventListener('change', state => {
      if (state !== 'active') void downloadQueue.pauseAll().catch(() => { libraryError = '后台暂停下载记录保存失败，请检查空间'; refreshUI() })
    })
    refreshUI()
  })().catch(error => { libraryError = String(error?.message ?? '资料库初始化失败'); refreshUI(); throw error })
  return initializePromise
}
export function useLibrary() {
  const [, render] = useState(0)
  useEffect(() => { const notify = () => { render(v => v + 1) }; listeners.add(notify); void initializeLibrary().catch(() => {}); return () => { listeners.delete(notify) } }, [])
  return librarySnapshot()
}
export function useDownloadQueue() {
  const [, render] = useState(0)
  useEffect(() => { void initializeLibrary().catch(() => {}); return downloadQueue.subscribe(() => { render(v => v + 1) }) }, [])
  return downloadQueue.snapshot()
}
export async function refreshConfig() { configuration = await nativeCommand<LibraryConfig>('config.read'); refreshUI(); return configuration }
export async function saveAccount(value: Partial<LibraryAccount> & { password?: string }) {
  configuration = await nativeCommand<LibraryConfig>('account.save', value); refreshUI(); return configuration
}
export async function removeAccount(id: string) { configuration = await nativeCommand<LibraryConfig>('account.remove', { id }); refreshUI() }
export async function setCacheLimit(megabytes: number) { configuration = await nativeCommand<LibraryConfig>('cache.limit', { megabytes }); refreshUI() }
export async function clearCache(kind: 'audio' | 'directory') { await nativeCommand('cache.clear', { kind }) }
export function operation<T>(command: string, payload: Record<string, unknown>, progress?: (event: TransferProgress) => void) {
  const id = operationId()
  if (progress) progresses.set(id, progress)
  const promise = nativeCommand<T>(command, { ...payload, operationId: id }).finally(() => { progresses.delete(id) })
  return { id, promise, cancel: () => { cancelOperation(id) } }
}
export const browseDirectory = (accountId: string, path = '', force = false) => operation<DirectoryEntry[]>('directory.list', { accountId, path, force })
export const prepareLibraryPlayback = (reference: LibraryReference) => operation<{ url: string, lease: string, cached: boolean }>('playback.prepare', { reference })
export const releaseLibraryPlayback = async(lease: string) => { await nativeCommand('playback.release', { lease }) }
export async function importEntries(accountId: string, entries: DirectoryEntry[], listId: string) {
  const music = entries.filter(entry => !entry.directory && /\.(mp3|flac|m4a|aac|wav|aif|aiff)$/i.test(entry.name)).map(entry => entryMusic(accountId, entry))
  if (!music.length) throw new Error('未选择支持的音频文件')
  // Playlist creation belongs to My Lists. Import never silently creates a list.
  const known = ['default', 'love', ...(await getUserLists()).map(list => list.id)]
  if (!listId || !known.includes(listId)) throw new Error('请先在我的列表中新建或选择目标歌单')
  await addListMusics(listId, music, 'bottom')
  return { id: listId, count: music.length }
}
export async function addPublished(file: PublishedFile, listId: string, original?: LX.Music.MusicInfo) {
  await addListMusics(listId, [publishedMusic(file, original)], 'bottom')
}
export async function enqueueDownloads(music: LX.Music.MusicInfo[], destination?: Destination) {
  await initializeLibrary(); await downloadQueue.enqueue(music, destination)
}
async function consistentSnapshot<T>(task: () => Promise<T>): Promise<T> {
  await initializeLibrary()
  if (exclusiveUI) throw new Error('另一个备份或恢复操作正在执行')
  exclusiveUI = true; refreshUI()
  const release = await downloadQueue.suspend().catch(error => { exclusiveUI = false; refreshUI(); throw error })
  try {
    // Stop playback writes before taking the existing list and storage gates.
    const player = await import('@/core/player/player'); await player.pause()
    return await global.list_event.list_data_withSnapshot(async() => withStorageSnapshot(task))
  } finally { release(); exclusiveUI = false; refreshUI() }
}
export function createEncryptedBackup(kind: 'full' | 'playlists', password: string, includeCaches: boolean, progress?: (event: TransferProgress) => void) {
  return consistentSnapshot(() => operation<BackupFile>('backup.create', { kind, password, includeCaches }, progress).promise)
}
export function stageEncryptedRestore(path: string, password: string, progress?: (event: TransferProgress) => void) {
  return consistentSnapshot(() => operation<RestoreStatus>('restore.stage', { path, password }, progress).promise)
}
export const restoreStatus = () => nativeCommand<RestoreStatus>('restore.status')
export const armRestore = (id: string) => nativeCommand<RestoreStatus>('restore.arm', { id })
export const cancelRestore = (id: string) => nativeCommand<void>('restore.cancel', { id })
export const acknowledgeRestore = () => nativeCommand<RestoreStatus>('restore.ack')
export const uploadBackup = (path: string, accountId: string, folder: string, progress?: (event: TransferProgress) => void) => operation<{ path: string }>('backup.upload', { path, accountId, folder }, progress)
export const fetchBackup = (accountId: string, path: string, progress?: (event: TransferProgress) => void) => operation<{ path: string }>('backup.fetch', { accountId, path }, progress)
export const localDownloadPath = (path: string) => nativeCommand<string>('file.local', { path })

export async function downloadFromMenu(music: LX.Music.MusicInfo[]) {
  try { await enqueueDownloads(music); openLibraryPage('downloads') }
  catch (error: any) { const { toast } = await import('@/utils/tools'); toast(String(error?.message ?? '加入下载失败')) }
}
