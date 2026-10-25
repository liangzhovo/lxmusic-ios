/** Resolve by stable song ID, never by the player's possibly stale queue index.
 * Reading this helper cannot change playback or the player's queue.
 */
export interface LibraryLocation { listId: string, musicId: string, index: number }
export const findMusicIndex = (musics: ReadonlyArray<{ id: string }>, musicId: string) =>
  musicId ? musics.findIndex(music => music.id === musicId) : -1

export const resolveLibraryLocation = async({ musicId, activeListId, playingListId, listIds, readList, isCurrent }: {
  musicId: string
  activeListId: string
  playingListId: string | null
  listIds: readonly string[]
  readList: (id: string) => Promise<ReadonlyArray<{ id: string }>>
  isCurrent: () => boolean
}): Promise<LibraryLocation | null> => {
  if (!musicId || !isCurrent()) return null
  const available = new Set(listIds)
  const candidates = [...new Set([activeListId, playingListId ?? '', ...listIds])].filter(id => available.has(id))
  for (const listId of candidates) {
    if (!isCurrent()) return null
    const musics = await readList(listId)
    if (!isCurrent()) return null
    const index = findMusicIndex(musics, musicId)
    if (index !== -1) return { listId, musicId, index }
  }
  return null
}
