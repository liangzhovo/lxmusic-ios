/** Persistent, complete-file audio cache. No dependency on a React Native runtime. */
export interface CacheFile {
  name: string
  size: number
  mtime: number
  isFile: boolean
}
export interface CacheDownload {
  cancel: () => void
  done: Promise<{ status: number, bytes: number, expected: number, completeRange?: boolean }>
}
export interface AudioCacheIO {
  mkdir: (path: string) => Promise<void>
  list: (path: string) => Promise<CacheFile[]>
  read: (path: string) => Promise<string>
  write: (path: string, text: string) => Promise<void>
  touch: (path: string) => Promise<void>
  head: (path: string) => Promise<Uint8Array>
  hash: (path: string) => Promise<string>
  move: (from: string, to: string) => Promise<void>
  copy: (from: string, to: string) => Promise<void>
  remove: (path: string) => Promise<void>
  stat: (path: string) => Promise<{ size: number }>
  download: (url: string, path: string, maxBytes: number) => CacheDownload
  digestKey: (key: string) => string
  id: () => string
  log: (event: string, detail?: string) => void
}
interface Entry {
  schema: 1
  key: string
  file: string
  size: number
  sha256: string
  accessed: number
}
interface Job {
  key: string
  part: string
  folder: string
  epoch: number
  task: CacheDownload
}

export const audioCacheKey = (source: string, id: string, quality: string) => JSON.stringify(['audio-v1', source, id, quality])
export const audioExtension = (b: Uint8Array): string | null => {
  const text = (start: number, count: number) => String.fromCharCode(...b.slice(start, start + count))
  if (b.length < 12) return null
  if (text(0, 4) == 'fLaC') return 'flac'
  if (text(0, 3) == 'ID3') return 'mp3'
  if (text(0, 4) == 'RIFF' && text(8, 4) == 'WAVE') return 'wav'
  if (text(0, 4) == 'OggS') return 'ogg'
  if (text(4, 4) == 'ftyp') return 'm4a'
  if (text(0, 4) == 'FORM' && ['AIFF', 'AIFC'].includes(text(8, 4))) return 'aiff'
  if (b[0] == 0xff && (b[1] & 0xf6) == 0xf0) return 'aac'
  if (b[0] == 0xff && (b[1] & 0xe0) == 0xe0 && (b[1] & 0x06) != 0) return 'mp3'
  return null
}

const fileURL = (path: string) => `file://${path.split('/').map(encodeURIComponent).join('/')}`
const safeName = /^[a-zA-Z0-9_-]+\.(?:mp3|flac|wav|ogg|m4a|aac|aiff)$/
export class DiskAudioCache {
  private serial: Promise<unknown> = Promise.resolve()
  private folder = ''
  private entries = new Map<string, Entry>()
  private job: Job | null = null
  private epoch = 0
  private limit = 0
  private ready = false

  constructor(private readonly root: string, private readonly io: AudioCacheIO) {}

  private locked<T>(work: () => Promise<T>): Promise<T> {
    const next = this.serial.then(work, work)
    this.serial = next.catch(() => {})
    return next
  }
  private async remove(path: string) { await this.io.remove(path).catch(() => {}) }
  private manifest(entry: Entry) { return `${this.folder}/${entry.file}.json` }
  private async writeState(generation: string) {
    const pending = `${this.root}/state.next.json`
    await this.io.write(pending, JSON.stringify({ schema: 1, generation }))
    await this.remove(`${this.root}/state.json`)
    await this.io.move(pending, `${this.root}/state.json`)
  }
  private async init() {
    if (this.ready) return
    await this.io.mkdir(this.root)
    let state: { schema?: number, generation?: string } = {}
    for (const name of ['state.json', 'state.next.json']) {
      try {
        const candidate = JSON.parse(await this.io.read(`${this.root}/${name}`))
        if (candidate.schema == 1 && typeof candidate.generation == 'string' && /^[a-zA-Z0-9_-]+$/.test(candidate.generation)) {
          state = candidate
          break
        }
      } catch {}
    }
    const generation = state.generation ?? this.io.id()
    this.folder = `${this.root}/${generation}`
    await this.io.mkdir(this.folder)
    if (!state.generation) await this.writeState(generation)
    // Only the playback leases and unfinished writes are disposable at startup.
    // Completed audio in the active generation must survive a process restart.
    await this.remove(`${this.root}/playback`)
    await this.io.mkdir(`${this.root}/playback`)
    for (const file of await this.io.list(this.folder)) {
      if (!file.isFile || !file.name.endsWith('.json')) continue
      try {
        const entry: Entry = JSON.parse(await this.io.read(`${this.folder}/${file.name}`))
        if (entry.schema != 1 || typeof entry.key != 'string' || !safeName.test(entry.file) || file.name != `${entry.file}.json` ||
            !Number.isFinite(entry.size) || entry.size <= 0 || !/^[a-f0-9]{64}$/.test(entry.sha256) || !Number.isFinite(entry.accessed)) throw new Error('invalid manifest')
        if ((await this.io.stat(`${this.folder}/${entry.file}`)).size != entry.size) throw new Error('incomplete audio')
        entry.accessed = file.mtime || entry.accessed
        const previous = this.entries.get(entry.key)
        if (!previous || previous.accessed < entry.accessed) this.entries.set(entry.key, entry)
      } catch { await this.remove(`${this.folder}/${file.name}`) }
    }
    const keep = new Set([...this.entries.values()].flatMap(e => [e.file, `${e.file}.json`]))
    for (const file of await this.io.list(this.folder)) {
      if (!keep.has(file.name)) await this.remove(`${this.folder}/${file.name}`)
    }
    for (const file of await this.io.list(this.root)) {
      if (!file.isFile && file.name != generation && file.name != 'playback') await this.remove(`${this.root}/${file.name}`)
    }
    this.ready = true
    this.io.log('restored', String(this.entries.size))
  }
  private cancel() {
    this.epoch++
    const old = this.job
    this.job = null
    old?.task.cancel()
  }
  private async discard(entry: Entry) {
    this.entries.delete(entry.key)
    await this.remove(this.manifest(entry))
    await this.remove(`${this.folder}/${entry.file}`)
  }
  private async prune() {
    let total = [...this.entries.values()].reduce((sum, e) => sum + e.size, 0)
    for (const entry of [...this.entries.values()].sort((a, b) => a.accessed - b.accessed)) {
      if (total <= this.limit) break
      await this.discard(entry)
      total -= entry.size
      this.io.log('evicted')
    }
  }
  configure(maxBytes: number) {
    return this.locked(async() => {
      await this.init()
      const next = Number.isFinite(maxBytes) ? Math.max(0, Math.floor(maxBytes)) : 0
      if (next != this.limit) this.cancel()
      this.limit = next
      await this.prune()
    })
  }
  lookup(key: string): Promise<string | null> {
    return this.locked(async() => {
      await this.init()
      if (!this.limit) return null
      const entry = this.entries.get(key)
      if (!entry) { this.io.log('miss'); return null }
      const file = `${this.folder}/${entry.file}`
      try {
        if ((await this.io.stat(file)).size != entry.size || await this.io.hash(file) != entry.sha256 || !audioExtension(await this.io.head(file))) throw new Error('integrity mismatch')
        entry.accessed = Date.now()
        // Touch metadata without rewriting its validity record during playback.
        await this.io.touch(this.manifest(entry)).catch(() => {})
        this.io.log('hit')
        return fileURL(file)
      } catch {
        await this.discard(entry)
        this.io.log('corrupt-entry-removed')
        return null
      }
    })
  }
  invalidate(key: string, strict = false) {
    return this.locked(async() => {
      await this.init()
      if (this.job?.key == key) this.cancel()
      const entry = this.entries.get(key)
      if (!entry) return
      if (!strict) { await this.discard(entry); return }
      const removeStrict = async(path: string) => {
        try { await this.io.remove(path) } catch (error) {
          // A missing file is already invalidated; real storage failures surface.
          const stillExists = await this.io.stat(path).then(() => true, () => false)
          if (stillExists) throw error
        }
      }
      await removeStrict(this.manifest(entry))
      await removeStrict(`${this.folder}/${entry.file}`)
      this.entries.delete(key)
    })
  }
  /** One extra cache transfer at a time; never wait for it to start playback. */
  prefetch(key: string, url: string): Promise<void> {
    return this.locked(async() => {
      await this.init()
      if (!this.limit || !/^https?:\/\//i.test(url) || this.entries.has(key) || this.job?.key == key) return
      this.cancel()
      const part = `${this.folder}/${this.io.digestKey(key)}-${this.io.id()}.part`
      const job: Job = { key, part, folder: this.folder, epoch: this.epoch, task: this.io.download(url, part, this.limit) }
      this.job = job
      this.io.log('download-start')
      void job.task.done.then(result => this.locked(async() => {
        if (job.epoch != this.epoch || this.job !== job || job.folder != this.folder || !this.limit) return
        // A range or error document must never be promoted as a complete song.
        if ((result.status != 200 && !(result.status == 206 && result.completeRange)) || result.bytes <= 0 || result.bytes > this.limit ||
            (result.expected > 0 && result.bytes != result.expected)) throw new Error('incomplete HTTP response')
        const stat = await this.io.stat(part)
        if (stat.size != result.bytes) throw new Error('file size mismatch')
        const extension = audioExtension(await this.io.head(part))
        if (!extension) throw new Error('not a supported audio file')
        const sha256 = await this.io.hash(part)
        const name = `${this.io.digestKey(key)}-${this.io.id()}.${extension}`
        const entry: Entry = { schema: 1, key, file: name, size: stat.size, sha256, accessed: Date.now() }
        const path = `${this.folder}/${name}`
        const temp = `${path}.json.tmp`
        try {
          await this.io.move(part, path)
          // Publish the manifest last. Unindexed audio is not a cache hit.
          await this.io.write(temp, JSON.stringify(entry))
          await this.io.move(temp, `${path}.json`)
        } catch (error) {
          await this.remove(temp)
          await this.remove(path)
          throw error
        }
        const previous = this.entries.get(key)
        if (previous) await this.discard(previous)
        this.entries.set(key, entry)
        await this.prune()
        this.io.log('committed', String(entry.size))
      })).catch(() => { this.io.log('download-not-cached') }).finally(() => {
        void this.locked(async() => {
          await this.remove(part)
          if (this.job === job) this.job = null
        })
      })
    })
  }
  cancelPending() { this.cancel() }

  /**
   * 注册本地已存在的音频文件进缓存（供"下载功能"把下载完成的文件接入播放缓存）。
   * 与 prefetch 复用同一 manifest 流程：移动文件进缓存目录 + 发布 manifest。
   * 成功返回缓存内 file:// 路径；格式不受支持或失败返回 null（下载文件仍留在原目录）。
   */
  registerLocalFile(key: string, sourcePath: string): Promise<string | null> {
    return this.locked(async() => {
      await this.init()
      if (!this.limit || this.entries.has(key) || !/^file:\/\//i.test(sourcePath)) return null
      try {
        const stat = await this.io.stat(sourcePath)
        if (stat.size <= 0) return null
        const extension = audioExtension(await this.io.head(sourcePath))
        if (!extension) return null
        const sha256 = await this.io.hash(sourcePath)
        const name = `${this.io.digestKey(key)}-${this.io.id()}.${extension}`
        const entry: Entry = { schema: 1, key, file: name, size: stat.size, sha256, accessed: Date.now() }
        const path = `${this.folder}/${name}`
        const temp = `${path}.json.tmp`
        try {
          await this.io.move(sourcePath, path)
          // Publish the manifest last. Unindexed audio is not a cache hit.
          await this.io.write(temp, JSON.stringify(entry))
          await this.io.move(temp, `${path}.json`)
        } catch (error) {
          await this.remove(temp)
          await this.remove(path)
          throw error
        }
        const previous = this.entries.get(key)
        if (previous) await this.discard(previous)
        this.entries.set(key, entry)
        await this.prune()
        this.io.log('registered', String(entry.size))
        return fileURL(path)
      } catch (error) {
        this.io.log('register-failed', String(error))
        return null
      }
    })
  }
  importCompleteFile(key: string, source: string, stillCurrent: () => boolean = () => true): Promise<void> {
    return this.locked(async() => {
      await this.init()
      if (!this.limit || this.entries.has(key) || !stillCurrent()) return
      const size = (await this.io.stat(source)).size
      if (size <= 0 || size > this.limit) return
      const ext = audioExtension(await this.io.head(source))
      if (!ext) throw new Error('Unsupported completed audio format')
      const file = `${this.io.digestKey(key)}-${this.io.id()}.${ext}`
      const target = `${this.folder}/${file}`
      const pending = `${target}.json.tmp`
      try {
        await this.io.copy(source, target)
        const entry: Entry = { schema: 1, key, file, size, sha256: await this.io.hash(target), accessed: Date.now() }
        if ((await this.io.stat(target)).size != size || !stillCurrent()) throw new Error('Completed stream superseded')
        await this.io.write(pending, JSON.stringify(entry))
        if (!stillCurrent()) throw new Error('Completed stream superseded')
        await this.io.move(pending, `${target}.json`)
        this.entries.set(key, entry)
        await this.prune()
        this.io.log('stream-committed', String(size))
      } catch (error) {
        await this.remove(pending); await this.remove(target)
        throw error
      }
    })
  }
  clear() {
    return this.locked(async() => {
      await this.init()
      this.cancel()
      const old = this.folder
      const generation = this.io.id()
      const next = `${this.root}/${generation}`
      await this.io.mkdir(next)
      await this.writeState(generation)
      this.folder = next
      this.entries.clear()
      // Late callbacks target the old, removed generation and cannot republish.
      await this.remove(old)
      this.io.log('cleared')
    })
  }
  size() {
    return this.locked(async() => {
      await this.init()
      let total = [...this.entries.values()].reduce((sum, e) => sum + e.size, 0)
      if (this.job) total += await this.io.stat(this.job.part).then(s => s.size).catch(() => 0)
      return total
    })
  }
  acquire(url: string): Promise<string> {
    if (!url.startsWith(`${fileURL(this.root)}/`)) return Promise.resolve(url)
    return this.locked(async() => {
      await this.init()
      const prefix = `${fileURL(this.folder)}/`
      if (!url.startsWith(prefix)) return url
      const name = url.slice(prefix.length)
      if (!safeName.test(name)) throw new Error('Invalid cache playback path')
      const entry = [...this.entries.values()].find(e => e.file == name)
      if (!entry) throw new Error('Cache entry was cleared before playback')
      const file = `${this.root}/playback/${this.io.id()}-${name}`
      await this.io.copy(`${this.folder}/${name}`, file)
      return fileURL(file)
    })
  }
  release(url: string) {
    if (!url.startsWith(`${fileURL(this.root)}/playback/`)) return Promise.resolve()
    return this.locked(async() => {
      const prefix = `${fileURL(this.root)}/playback/`
      if (url.startsWith(prefix) && safeName.test(url.slice(prefix.length))) await this.remove(decodeURIComponent(url.slice('file://'.length)))
    })
  }
  /** Allows tests to wait for the current transfer without delaying playback. */
  async idle() {
    await this.serial
    await this.job?.task.done.catch(() => {})
    await this.serial
    await this.serial
  }
}
