import type { Destination, DownloadJob, DownloadState, PublishedFile, TransferProgress, TransferSource } from './types'

const running = new Set(['resolving', 'downloading', 'uploading', 'verifying'])
const statuses = new Set(['queued', ...running, 'paused', 'failed', 'completed'])
const qualities = new Set(['128k', '320k', 'flac', 'flac24bit'])
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value))
export const newQueueState = (): DownloadState => ({ schema: 1, enabled: false, quality: '320k', destination: { kind: 'local' }, jobs: [] })
export const validateDestination = (target: any): target is Destination => !!target && (target.kind === 'local' ||
  (target.kind === 'webdav' && typeof target.accountId === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(target.accountId) && typeof target.path === 'string' && target.path.length <= 8192))
export function validateQueue(raw: any): DownloadState {
  if (!raw || raw.schema !== 1 || typeof raw.enabled !== 'boolean' || !qualities.has(raw.quality) || !validateDestination(raw.destination) || !Array.isArray(raw.jobs) || raw.jobs.length > 5000) {
    throw new Error('下载队列格式损坏或版本不兼容；原数据未重置')
  }
  const ids = new Set<string>()
  for (const job of raw.jobs) {
    if (!job || typeof job.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(job.id) || ids.has(job.id) ||
      !job.music || typeof job.music.id !== 'string' || typeof job.music.name !== 'string' || !job.music.meta || typeof job.music.source !== 'string' ||
      !qualities.has(job.quality) || !validateDestination(job.destination) || !statuses.has(job.status) ||
      !Number.isFinite(job.received) || job.received < 0 || !Number.isFinite(job.total) || job.total < 0 || !Number.isFinite(job.created)) throw new Error('下载任务数据损坏；原记录未覆盖')
    if (job.status === 'completed' && (!job.result || !['local', 'webdav'].includes(job.result.kind) || typeof job.result.path !== 'string' || !/^[a-f0-9]{64}$/.test(job.result.sha256) || !Number.isFinite(job.result.size) || job.result.size < 0 || typeof job.result.name !== 'string' || !/^(mp3|flac|m4a|wav|aiff|aac)$/.test(job.result.ext) || (job.result.kind === 'webdav' && typeof job.result.accountId !== 'string'))) {
      throw new Error('已下载文件记录不完整；原记录未覆盖')
    }
    ids.add(job.id)
  }
  return clone(raw)
}
export interface QueueDependencies {
  read: () => Promise<unknown>
  save: (state: DownloadState) => Promise<void>
  resolve: (job: DownloadJob) => Promise<TransferSource>
  execute: (job: DownloadJob, source: TransferSource, operationId: string) => Promise<PublishedFile>
  cancel: (operationId: string) => void
  discardPartial: (jobId: string) => Promise<void>
  id: () => string
  now: () => number
}

/** Durable one-at-a-time scheduler. A URL is resolved afresh for each attempt,
 * held only in the running stack, and never serialized in a queue checkpoint.
 * Native verified-prefix checkpoints/receipts own byte-level resumption.
 */
export class DownloadQueue {
  private state = newQueueState()
  private initialized = false
  private initializePromise?: Promise<void>
  private tail: Promise<unknown> = Promise.resolve()
  private listeners = new Set<() => void>()
  private held = 0
  private failedPersistence = false
  private active?: { jobId: string, operationId: string, cancelled: boolean, cancelResolution: () => void, done: Promise<void> }
  private viewError = ''
  constructor(private readonly deps: QueueDependencies) {}
  snapshot = () => ({ ...clone(this.state), error: this.viewError, initialized: this.initialized })
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private emit() { for (const listener of this.listeners) listener() }
  initialize(): Promise<void> {
    if (this.initializePromise) return this.initializePromise
    this.initializePromise = (async() => {
      const raw = await this.deps.read()
      const state = raw == null ? newQueueState() : validateQueue(raw)
      let changed = raw == null
      for (const job of state.jobs) if (running.has(job.status) || job.status === 'queued') {
        job.status = 'paused'; job.error = '应用已重新启动，请确认后继续'; changed = true
      }
      if (changed) await this.deps.save(state)
      this.state = state; this.initialized = true; this.emit()
    })().catch(error => { this.viewError = String(error?.message ?? '无法读取下载队列'); this.emit(); throw error })
    return this.initializePromise
  }
  private async mutate(change: (draft: DownloadState) => void) {
    await this.initialize()
    const action = this.tail.then(async() => {
      const next = clone(this.state); change(next); validateQueue(next)
      try { await this.deps.save(next) }
      catch (error) {
        this.failedPersistence = true; this.viewError = '下载记录保存失败，已停止启动新任务；请检查可用空间后重试'
        this.emit(); throw error
      }
      this.state = next; this.failedPersistence = false; this.viewError = ''; this.emit()
    })
    this.tail = action.catch(() => {})
    await action
    this.kick()
  }
  async configure(value: { quality?: LX.Quality, destination?: Destination }) {
    if (value.quality && !qualities.has(value.quality)) throw new Error('不支持的音质')
    if (value.destination && !validateDestination(value.destination)) throw new Error('下载目标无效')
    await this.mutate(state => { if (value.quality) state.quality = value.quality; if (value.destination) state.destination = clone(value.destination) })
  }
  async setEnabled(enabled: boolean) {
    if (!enabled && this.active) { this.active.cancelled = true; this.active.cancelResolution(); this.deps.cancel(this.active.operationId) }
    await this.mutate(state => { state.enabled = enabled })
    if (!enabled) await this.pauseAll()
  }
  async enqueue(musics: LX.Music.MusicInfo[], destination?: Destination, quality?: LX.Quality) {
    if (!musics.length) return
    await this.mutate(state => {
      if (!state.enabled) throw new Error('下载功能默认关闭，请先在资料库中启用')
      const target = clone(destination ?? state.destination), q = quality ?? state.quality
      if (!validateDestination(target) || !qualities.has(q)) throw new Error('音质或下载目标无效')
      const targetKey = JSON.stringify(target)
      for (const music of musics) {
        if (state.jobs.some(job => job.music.id === music.id && job.quality === q && JSON.stringify(job.destination) === targetKey)) continue
        if (state.jobs.length >= 5000) throw new Error('下载队列已达到5000项上限，请先清理记录')
        state.jobs.push({ id: this.deps.id(), music: clone(music), quality: q, destination: target, status: 'queued', received: 0, total: 0, created: this.deps.now() })
      }
    })
  }
  private update(id: string, action: (job: DownloadJob) => void) {
    return this.mutate(state => { const job = state.jobs.find(j => j.id === id); if (job) action(job) })
  }
  progress(event: TransferProgress) {
    if (!this.active || this.active.operationId !== event.operationId || this.active.cancelled) return
    const job = this.state.jobs.find(job => job.id === this.active?.jobId)
    if (!job || !running.has(job.status)) return
    if (['downloading', 'uploading', 'verifying'].includes(event.phase)) job.status = event.phase as DownloadJob['status']
    if (Number.isFinite(event.received)) job.received = Math.max(0, event.received)
    if (Number.isFinite(event.total)) job.total = Math.max(0, event.total)
    this.emit() // Persist at state boundaries, not every network chunk.
  }
  private kick() {
    if (!this.initialized || this.active || !this.state.enabled || this.held > 0 || this.failedPersistence) return
    const job = this.state.jobs.find(j => j.status === 'queued')
    if (!job) return
    let cancelResolution = () => {}
    const cancelledResolution = new Promise<never>((_, reject) => { cancelResolution = () => { reject(new Error('已暂停')) } })
    // A rejection handler exists even when cancellation happens before resolve.
    void cancelledResolution.catch(() => {})
    const active = { jobId: job.id, operationId: this.deps.id(), cancelled: false, cancelResolution, done: Promise.resolve() }
    this.active = active
    active.done = (async() => {
      try {
        await this.update(job.id, j => { j.status = 'resolving'; delete j.error })
        if (active.cancelled) throw new Error('已暂停')
        const source = await Promise.race([this.deps.resolve(clone(job)), cancelledResolution])
        if (active.cancelled || !this.state.enabled || this.held > 0) throw new Error('已暂停')
        await this.update(job.id, j => { j.status = 'downloading' })
        if (active.cancelled) throw new Error('已暂停')
        const result = await this.deps.execute(clone(job), source, active.operationId)
        await this.update(job.id, j => {
          if (active.cancelled) { j.status = 'paused'; j.error = '已暂停；目标已完成时，下次继续会核验原文件' }
          else { j.status = 'completed'; j.result = result; j.received = result.size; j.total = result.size; delete j.error }
        })
      } catch (error: any) {
        try { await this.update(job.id, j => { j.status = active.cancelled || this.held > 0 || !this.state.enabled ? 'paused' : 'failed'; j.error = active.cancelled ? '已暂停，可继续验证式续传' : String(error?.message ?? '下载失败') }) }
        catch { /* Persistence failure remains visible; no automatic reset/retry. */ }
      } finally { if (this.active === active) this.active = undefined; this.emit(); this.kick() }
    })()
  }
  async pause(id: string) {
    const active = this.active?.jobId === id ? this.active : undefined
    if (active) { active.cancelled = true; active.cancelResolution(); this.deps.cancel(active.operationId); await active.done }
    await this.update(id, job => { if (job.status !== 'completed') job.status = 'paused' })
  }
  async pauseAll() {
    this.held++
    try {
      const active = this.active
      if (active) { active.cancelled = true; active.cancelResolution(); this.deps.cancel(active.operationId); await active.done }
      await this.mutate(state => { for (const job of state.jobs) if (job.status === 'queued' || running.has(job.status)) job.status = 'paused' })
    } finally { this.held--; this.kick() }
  }
  async suspend(): Promise<() => void> {
    this.held++
    try { await this.pauseAll() } catch (e) { this.held--; throw e }
    let released = false
    return () => { if (!released) { released = true; this.held--; this.kick() } }
  }
  async retry(id: string) {
    await this.update(id, job => {
      if (!this.state.enabled) throw new Error('请先启用下载功能')
      if (job.status === 'completed' || running.has(job.status)) return
      job.status = 'queued'; delete job.error
    })
  }
  async remove(id: string) {
    await this.pause(id)
    await this.deps.discardPartial(id)
    // Completed user files and remote files are never removed with a queue row.
    await this.mutate(state => { state.jobs = state.jobs.filter(j => j.id !== id) })
  }
  async settled() {
    for (;;) {
      const tail = this.tail; await tail
      const active = this.active
      if (active) { await active.done; continue }
      if (tail === this.tail) return
    }
  }
}
