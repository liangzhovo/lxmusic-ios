export interface LibraryAccount {
  id: string
  name: string
  endpoint: string
  username: string
  allowHTTP: boolean
  directoryCache: boolean
  audioCache: boolean
  revision: string
  passwordSaved: boolean
}
export interface LibraryConfig { schema: 1, accounts: LibraryAccount[], audioLimitMB: number }
export interface LibraryReference {
  kind: 'webdav' | 'local'
  accountId?: string
  path: string
  etag?: string | null
  size?: number | null
  sha256?: string | null
}
export interface DirectoryEntry { path: string, name: string, directory: boolean, size?: number | null, etag?: string | null, modified?: string | null }
export interface PublishedFile { kind: 'webdav' | 'local', accountId?: string, path: string, name: string, size: number, sha256: string, ext: string }
export type Destination = { kind: 'local' } | { kind: 'webdav', accountId: string, path: string }
export type TransferSource = { kind: 'url', url: string } | { kind: 'local', path: string } | LibraryReference
export interface TransferProgress { operationId: string, phase: string, received: number, total: number }
export interface RestoreStatus { state: 'none' | 'prepared' | 'ready' | 'applying' | 'awaitingAck' | 'acknowledged' | 'restored' | 'rolledBack' | 'cancelled', message: string, id?: string, kind?: string, files?: number, bytes?: number, created?: number }
export interface BackupFile { path: string, name: string, size: number, sha256: string, kind: string }
export type DownloadStatus = 'queued' | 'resolving' | 'downloading' | 'uploading' | 'verifying' | 'paused' | 'failed' | 'completed'
export interface DownloadJob {
  id: string
  music: LX.Music.MusicInfo
  quality: LX.Quality
  destination: Destination
  status: DownloadStatus
  received: number
  total: number
  result?: PublishedFile
  error?: string
  created: number
}
export interface DownloadState { schema: 1, enabled: boolean, quality: LX.Quality, destination: Destination, jobs: DownloadJob[] }
