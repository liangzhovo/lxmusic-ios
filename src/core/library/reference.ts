import type { DirectoryEntry, LibraryReference, PublishedFile } from './types'
const prefix = 'lx-library://'
export const getLibraryReference = (music: LX.Music.MusicInfo | LX.Download.ListItem): LibraryReference | undefined =>
  !('progress' in music) && music.source === 'local' ? (music.meta as LX.Music.MusicInfoLocal['meta'] & { library?: LibraryReference }).library : undefined
export const encodeLibraryURL = (reference: LibraryReference) => prefix + encodeURIComponent(JSON.stringify(reference))
export const isLibraryURL = (url: string) => url.startsWith(prefix)
export function decodeLibraryURL(url: string): LibraryReference {
  if (!isLibraryURL(url) || url.length > 32768) throw new Error('音乐引用无效')
  const ref = JSON.parse(decodeURIComponent(url.slice(prefix.length))) as LibraryReference
  if (!ref || !['local', 'webdav'].includes(ref.kind) || typeof ref.path !== 'string' || (ref.kind === 'webdav' && typeof ref.accountId !== 'string')) throw new Error('音乐引用无效')
  return ref
}
export const supportedAudio = (name: string) => /\.(mp3|flac|m4a|aac|wav|aif|aiff)$/i.test(name)
export function libraryMusic(ref: LibraryReference, filename: string, original?: LX.Music.MusicInfo): LX.Music.MusicInfoLocal {
  const id = ref.kind === 'webdav' ? `webdav:${ref.accountId}:${ref.path}` : `local-download:${ref.path}`
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  return {
    id, name: original?.name ?? filename.replace(/\.[^.]+$/, ''), singer: original?.singer ?? '', interval: original?.interval ?? '', source: 'local',
    meta: { filePath: encodeLibraryURL(ref), ext, songId: id, albumName: original?.meta.albumName ?? '', library: ref },
  } as LX.Music.MusicInfoLocal
}
export const entryMusic = (accountId: string, entry: DirectoryEntry) => libraryMusic({ kind: 'webdav', accountId, path: entry.path, etag: entry.etag, size: entry.size }, entry.name)
export const publishedMusic = (file: PublishedFile, original?: LX.Music.MusicInfo) => libraryMusic({ kind: file.kind, accountId: file.accountId, path: file.path, size: file.size, sha256: file.sha256 }, file.name, original)
