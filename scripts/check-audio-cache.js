// Real filesystem + localhost HTTP tests. No React Native mocks for the cache itself.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const http = require('node:http')
const { fileURLToPath } = require('node:url')
const { spawnSync } = require('node:child_process')
const Module = require('node:module')
const ts = require('typescript')
const source = path.resolve(__dirname, '../src/plugins/player/cache/DiskAudioCache.ts')
const moduleObject = new Module(source, module)
moduleObject._compile(ts.transpileModule(require('node:fs').readFileSync(source, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText, source)
const { DiskAudioCache, audioCacheKey, audioExtension } = moduleObject.exports
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
let requests = 0
const makeIO = () => ({
  mkdir: async p => { await fs.mkdir(p, { recursive: true }) },
  list: async p => Promise.all((await fs.readdir(p, { withFileTypes: true })).map(async e => { const s = await fs.stat(path.join(p, e.name)); return { name: e.name, size: s.size, mtime: s.mtimeMs, isFile: e.isFile() } })),
  read: p => fs.readFile(p, 'utf8'), write: (p, v) => fs.writeFile(p, v), touch: p => fs.utimes(p, new Date(), new Date()),
  head: async p => (await fs.readFile(p)).subarray(0, 64), hash: async p => digest(await fs.readFile(p)),
  move: (a, b) => fs.rename(a, b), copy: (a, b) => fs.copyFile(a, b), remove: p => fs.rm(p, { recursive: true, force: true }),
  stat: p => fs.stat(p), digestKey: k => crypto.createHash('md5').update(k).digest('hex'), id: () => crypto.randomUUID(), log: () => {},
  download: (url, p, maxBytes) => {
    requests++
    let req
    const done = new Promise((resolve, reject) => {
      req = http.get(url, res => {
        const chunks = []
        let bytes = 0
        res.on('data', c => { bytes += c.length; chunks.push(c); if (bytes > maxBytes) req.destroy(new Error('oversize')) })
        res.on('error', reject)
        res.on('end', async() => {
          try {
            await fs.writeFile(p, Buffer.concat(chunks))
            const expected = Number(res.headers['content-length'] || -1)
            const range = /^bytes 0-(\d+)\/(\d+)$/.exec(res.headers['content-range'] || '')
            resolve({ status: res.statusCode, bytes, expected, completeRange: !!range && Number(range[1]) + 1 === Number(range[2]) && expected === Number(range[2]) })
          } catch (e) { reject(e) }
        })
      })
      req.on('error', reject)
      req.on('socket', socket => socket.on('error', reject))
    })
    return { done, cancel: () => req.destroy(new Error('cancelled')) }
  },
})
const key = (id, quality = '128k', source = 'test') => audioCacheKey(source, id, quality)
const settle = async cache => { await cache.idle(); await new Promise(resolve => setImmediate(resolve)); await cache.idle() }
async function run() {
  if (process.argv[2] === '--cold-hit') {
    const io = makeIO()
    io.download = () => { throw new Error('NETWORK MUST NOT BE USED AFTER RESTART') }
    const cache = new DiskAudioCache(process.argv[3], io)
    await cache.configure(100000)
    const url = await cache.lookup(key('restart'))
    assert.ok(url)
    assert.equal(digest(await fs.readFile(fileURLToPath(url))), process.argv[4])
    assert.equal(requests, 0)
    console.log('PASS cold process, offline cache hit')
    return
  }
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'LX cache space '))
  // Container signatures exercise file storage/validation; this is not a decoder test.
  const audio = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(509, 0x5a)])
  const flac = Buffer.concat([Buffer.from('fLaC'), Buffer.alloc(700, 0x43)])
  const wave = Buffer.alloc(128); wave.write('RIFF'); wave.write('WAVE', 8)
  let slowResponse
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost')
    if (url.pathname === '/slow') { slowResponse = res; res.writeHead(200, { 'content-length': audio.length }); res.write(audio.subarray(0, 16)); return }
    if (url.pathname === '/truncated') { res.writeHead(200, { 'content-length': audio.length * 2 }); res.write(audio); setTimeout(() => res.destroy(), 10); return }
    if (url.pathname === '/html') { res.writeHead(200, { 'content-length': 100 }); res.end(Buffer.alloc(100, 0x3c)); return }
    const body = url.pathname === '/flac' ? flac : audio
    const status = url.pathname === '/partial' || url.pathname === '/range' ? 206 : url.pathname === '/error' ? 403 : 200
    res.writeHead(status, { 'content-length': body.length, ...(status === 206 ? { 'content-range': `bytes 0-${body.length - 1}/${url.pathname === '/partial' ? body.length * 2 : body.length}` } : {}) })
    res.end(body)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  let count = 0
  const test = async(name, fn) => { await fn(); count++; console.log(`PASS ${name}`) }
  const cache = new DiskAudioCache(root, makeIO())
  await cache.configure(100000)
  const store = async(id, endpoint = '/ok', quality = '128k') => { await cache.prefetch(key(id, quality), base + endpoint); await settle(cache) }
  try {
    await test('format signatures and stable source/id/quality separation', async() => {
      assert.equal(audioExtension(audio), 'mp3'); assert.equal(audioExtension(flac), 'flac'); assert.equal(audioExtension(wave), 'wav')
      assert.notEqual(key('one'), key('one', 'flac')); assert.notEqual(key('one'), key('one', '128k', 'other'))
      assert.equal(audioExtension(Buffer.from('<html>not an audio file</html>')), null)
    })
    await test('HTTP complete file published with hash; encoded paths playable', async() => {
      await store('restart'); const url = await cache.lookup(key('restart'))
      assert.ok(url.includes('%20')); assert.deepEqual(await fs.readFile(fileURLToPath(url)), audio)
      assert.equal(await cache.size(), audio.length)
    })
    await test('independent restarted process hits cache without networking', async() => {
      const result = spawnSync(process.execPath, [__filename, '--cold-hit', root, digest(audio)], { encoding: 'utf8', timeout: 20000 })
      assert.equal(result.status, 0, result.stdout + result.stderr)
    })
    await test('changed/expired URL does not replace existing stable-key cache', async() => {
      const before = requests; await cache.prefetch(key('restart'), `${base}/error?expired=true`); await settle(cache)
      assert.equal(requests, before); assert.ok(await cache.lookup(key('restart')))
    })
    await test('FLAC bytes and quality isolation persist independently', async() => {
      await store('restart', '/flac', 'flac'); const url = await cache.lookup(key('restart', 'flac'))
      assert.ok(url.endsWith('.flac')); assert.deepEqual(await fs.readFile(fileURLToPath(url)), flac)
      assert.ok((await cache.lookup(key('restart'))).endsWith('.mp3'))
    })
    for (const endpoint of ['/truncated', '/html', '/partial', '/error']) {
      await test(`reject ${endpoint} instead of marking complete`, async() => { await store(endpoint, endpoint); assert.equal(await cache.lookup(key(endpoint)), null) })
    }
    await test('206 only accepted when Content-Range represents entire resource', async() => { await store('range', '/range'); assert.ok(await cache.lookup(key('range'))) })
    await test('same-size corruption invalidates checksum and removes entry', async() => {
      await store('corrupt'); const url = await cache.lookup(key('corrupt')); const altered = Buffer.from(audio); altered[400] ^= 1
      await fs.writeFile(fileURLToPath(url), altered); assert.equal(await cache.lookup(key('corrupt')), null)
    })
    await test('missing files are removed from index', async() => {
      await store('missing'); await fs.unlink(fileURLToPath(await cache.lookup(key('missing')))); assert.equal(await cache.lookup(key('missing')), null)
    })
    await test('cache clear does not delete active playback lease', async() => {
      await store('lease'); const original = await cache.lookup(key('lease')); const lease = await cache.acquire(original)
      assert.notEqual(original, lease); await cache.clear(); assert.equal(await cache.size(), 0)
      assert.deepEqual(await fs.readFile(fileURLToPath(lease)), audio)
      await cache.release(lease); await assert.rejects(fs.stat(fileURLToPath(lease)))
    })
    await test('duplicate transfer deduplicated; clearing cancels unfinished transfer', async() => {
      const before = requests; await cache.prefetch(key('slow'), base + '/slow'); await cache.prefetch(key('slow'), base + '/slow')
      assert.equal(requests, before + 1); await cache.clear(); if (slowResponse) slowResponse.end()
      await settle(cache); assert.equal(await cache.lookup(key('slow')), null)
      await store('after-clear'); assert.ok(await cache.lookup(key('after-clear')))
    })
    await test('late success after cancellation cannot resurrect cleared cache', async() => {
      let resolveDownload; let target
      const io = makeIO(); io.download = (url, p) => { target = p; return { cancel: () => {}, done: new Promise(resolve => { resolveDownload = resolve }) } }
      const late = new DiskAudioCache(root + '-late', io); await late.configure(10000)
      await late.prefetch(key('late'), base + '/ok'); await late.clear()
      await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, audio)
      resolveDownload({ status: 200, bytes: audio.length, expected: audio.length }); await settle(late)
      assert.equal(await late.lookup(key('late')), null); assert.equal(await late.size(), 0)
      await fs.rm(root + '-late', { recursive: true, force: true })
    })
    await test('single-song invalidate removes only selected key and preserves active lease', async() => {
      await cache.configure(100000); await store('song-clear'); await store('song-keep')
      const lease = await cache.acquire(await cache.lookup(key('song-clear')))
      await cache.invalidate(key('song-clear'), true)
      assert.equal(await cache.lookup(key('song-clear')), null)
      assert.ok(await cache.lookup(key('song-keep')))
      assert.deepEqual(await fs.readFile(fileURLToPath(lease)), audio)
      const fresh = new DiskAudioCache(root, makeIO()); await fresh.configure(100000)
      assert.equal(await fresh.lookup(key('song-clear')), null)
      assert.ok(await fresh.lookup(key('song-keep')))
    })
    await test('explicit song clear surfaces filesystem denial', async() => {
      const io = makeIO(); const strict = new DiskAudioCache(root + '-strict', io)
      await strict.configure(100000); await strict.prefetch(key('denied'), base + '/ok'); await settle(strict)
      const remove = io.remove; io.remove = async() => { throw Error('permission denied') }
      await assert.rejects(strict.invalidate(key('denied'), true), /permission denied/)
      io.remove = remove; await strict.invalidate(key('denied'), true)
      assert.equal(await strict.lookup(key('denied')), null)
      await fs.rm(root + '-strict', { recursive: true, force: true })
    })
    await test('LRU honors touch and bounds total complete data' , async() => {
      await cache.clear(); await cache.configure(audio.length * 2)
      await store('old'); await new Promise(resolve => setTimeout(resolve, 3)); await store('new')
      await new Promise(resolve => setTimeout(resolve, 3)); await cache.lookup(key('old'))
      await store('third'); assert.equal(await cache.lookup(key('new')), null)
      assert.ok(await cache.lookup(key('old'))); assert.equal(await cache.size(), audio.length * 2)
    })
    await test('oversize download rejected and zero limit disables reads/writes', async() => {
      await cache.configure(100); await store('oversize'); assert.equal(await cache.lookup(key('oversize')), null)
      await cache.configure(0); const before = requests; await store('off'); assert.equal(requests, before); assert.equal(await cache.size(), 0)
    })
    await test('startup restores completed files but removes orphaned half-files', async() => {
      await cache.configure(100000); await store('retained')
      const state = JSON.parse(await fs.readFile(path.join(root, 'state.json'), 'utf8'))
      const unfinished = path.join(root, state.generation, 'orphan.part'); await fs.writeFile(unfinished, audio)
      const fresh = new DiskAudioCache(root, makeIO()); await fresh.configure(100000)
      assert.ok(await fresh.lookup(key('retained'))); await assert.rejects(fs.stat(unfinished))
    })
    console.log(`${count} audio cache behavioral checks passed (real disk, HTTP, cold-process offline test).`)
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await fs.rm(root, { recursive: true, force: true }) }
}
run().catch(error => { console.error(error); process.exitCode = 1 })
