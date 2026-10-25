// Coalesce a burst before touching audio. Only the latest request may publish a
// result; in-flight native work is allowed to finish, never replayed as a queue.
export interface LatestSeekOptions {
  seek: (target: number) => Promise<number>
  onResult: (position: number) => void
  onError: (error: unknown) => void
  delay?: number
}
export const createLatestSeek = ({ seek, onResult, onError, delay = 120 }: LatestSeekOptions) => {
  let revision = 0
  let pending: { target: number, revision: number } | null = null
  let running = false
  let ready = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const drain = async() => {
    if (running || !ready || !pending) return
    const request = pending
    pending = null
    ready = false
    running = true
    try {
      const position = await seek(request.target)
      if (request.revision == revision) {
        if (!Number.isFinite(position) || position < 0) throw new Error('Invalid native seek position')
        onResult(position)
      }
    } catch (error) {
      if (request.revision == revision) onError(error)
    } finally {
      running = false
      // A newer target whose quiet period already elapsed can now replace this
      // request. No intermediate targets are retained.
      void drain()
    }
  }
  return {
    get revision() { return revision },
    get busy() { return running || pending != null },
    request(target: number) {
      if (!Number.isFinite(target) || target < 0) return
      pending = { target, revision: ++revision }
      ready = false
      clearTimeout(timer)
      timer = setTimeout(() => { timer = undefined; ready = true; void drain() }, delay)
    },
    cancel() {
      revision++
      pending = null
      ready = false
      clearTimeout(timer)
      timer = undefined
    },
  }
}
