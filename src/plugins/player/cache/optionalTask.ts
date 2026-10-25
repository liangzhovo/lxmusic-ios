/** Cache work is optional. A stuck native filesystem operation must not hold
 * the playback path hostage. Late completions cannot change the chosen URL. */
export const optionalTask = <T>(task: Promise<T>, timeoutMs: number, fallback: T, label: string): Promise<T> => (
  new Promise(resolve => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      console.warn('[audio-cache] bypass timeout', label)
      resolve(fallback)
    }, timeoutMs)
    task.then(value => {
      if (settled) return
      settled = true; clearTimeout(timer); resolve(value)
    }, error => {
      if (settled) return
      settled = true; clearTimeout(timer)
      console.warn('[audio-cache] bypass failure', label, String(error))
      resolve(fallback)
    })
  })
)
