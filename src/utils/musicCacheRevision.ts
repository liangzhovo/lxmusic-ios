// Invalidations are synchronous; late URL responses may still play, but cannot
// repopulate caches cleared by the user. Storage mutations are ordered.
let generation = 0
const revisions = new Map<string, number>()
let writes: Promise<unknown> = Promise.resolve()
export const getMusicCacheRevision = (id: string) => `${generation}:${revisions.get(id) ?? 0}`
export const invalidateMusicCacheRevision = (id?: string) => {
  if (id == null) { generation++; revisions.clear() }
  else revisions.set(id, (revisions.get(id) ?? 0) + 1)
}
export const serializeMusicCacheWrite = <T,>(operation: () => Promise<T>): Promise<T> => {
  const result = writes.then(operation, operation)
  writes = result.then(() => {}, () => {})
  return result
}
