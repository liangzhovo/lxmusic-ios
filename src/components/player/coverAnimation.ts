export const COVER_REVOLUTION_MS = 120_000
export interface CoverAnimationDriver {
  stop: (read?: (value: number) => void) => void
  set: (value: number) => void
  run: (duration: number, completed: (finished: boolean) => void) => void
}

/** One native-driver animation, retaining the angle across pause/resume.
 * The generation belongs to one effect: a late native callback cannot restart
 * a hidden/unmounted cover, even after the next effect has already begun.
 */
export const startCoverRotation = (driver: CoverAnimationDriver, enabled: boolean) => {
  let disposed = false
  driver.stop(value => {
    if (disposed || !enabled) return
    let from = Number.isFinite(value) ? ((value % 1) + 1) % 1 : 0
    driver.set(from)
    const cycle = () => {
      driver.run((1 - from) * COVER_REVOLUTION_MS, finished => {
        if (disposed || !finished) return
        from = 0
        driver.set(0)
        cycle()
      })
    }
    cycle()
  })
  return () => { disposed = true; driver.stop() }
}
