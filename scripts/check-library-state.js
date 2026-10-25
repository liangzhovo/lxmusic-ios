/* Execute the production scheduler, not a parallel model of its transitions. */
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript')
const root = path.resolve(__dirname, '..')
function load(file, mocks = {}) {
  const result = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { fileName: file, reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } })
  assert.equal(result.diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error).length, 0)
  const exports = {}
  vm.runInNewContext(result.outputText, { exports, require: id => { assert.ok(Object.hasOwn(mocks, id), `unexpected ${id}`); return mocks[id] }, Promise, Date, Set, Map, Math, JSON, Error, console, setTimeout, clearTimeout })
  return exports
}
const { DownloadQueue, validateQueue, newQueueState } = load('src/core/library/DownloadQueue.ts')
const defer = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
const spin = async(test) => { for (let n = 0; n < 100; n++) { if (test()) return; await new Promise(r => setTimeout(r, 1)) }; throw Error('condition not reached') }
const song = id => ({ id, name: id, source: 'kw', singer: 'test', interval: '00:30', meta: { songId: id, albumName: '', qualitys: [], _qualitys: {} } })
const result = { kind: 'local', path: 'test.mp3', name: 'test.mp3', size: 100, sha256: 'a'.repeat(64), ext: 'mp3' }
function fixture(initial = null) {
  const f = { saved: initial, writes: [], resolved: [], transfers: [], cancellations: [], partials: [], failSave: false, seq: 0 }
  f.queue = new DownloadQueue({ read: async() => f.saved, save: async(state) => { if (f.failSave) throw Error('disk full'); f.saved = JSON.parse(JSON.stringify(state)); f.writes.push(f.saved) },
    resolve: async(job) => { f.resolved.push(job.id); return f.resolve ? f.resolve(job) : { kind: 'url', url: 'https://test.invalid/temporary?secret=not-persisted' } },
    execute: async(job, source, operation) => { f.transfers.push({ job, source, operation }); return f.execute ? f.execute(job, source, operation) : result },
    cancel: id => { f.cancellations.push(id); f.cancel?.(id) }, discardPartial: async id => { f.partials.push(id) }, id: () => 'job-' + ++f.seq, now: () => 100 })
  return f
}
let count = 0
async function check(name, body) { await body(); console.log('PASS ' + name); count++ }
;(async() => {
  await check('fresh installation persists default-disabled queue and performs no network', async() => { const f = fixture(); await f.queue.initialize(); assert.equal(f.saved.enabled, false); assert.equal(f.transfers.length, 0); await assert.rejects(f.queue.enqueue([song('a')]), /默认关闭/); assert.equal(f.transfers.length, 0) })
  await check('malformed or newer queue is not reset or overwritten', async() => { for (const raw of [{ schema: 2 }, { ...newQueueState(), jobs: [{}] }]) { const f = fixture(raw); await assert.rejects(f.queue.initialize()); assert.equal(f.writes.length, 0) } })
  await check('queued and interrupted jobs recover paused after restart, no automatic traffic', async() => {
    const initial = { ...newQueueState(), enabled: true, jobs: ['queued', 'resolving', 'downloading', 'uploading', 'verifying'].map((status, i) => ({ id: 'old' + i, music: song('a'), quality: '320k', destination: { kind: 'local' }, status, received: 1, total: 100, created: 1 })) }
    const f = fixture(initial); await f.queue.initialize(); assert.ok(f.saved.jobs.every(j => j.status === 'paused')); assert.equal(f.transfers.length, 0)
  })
  await check('durable enqueue precedes network start; source URL never serialized', async() => { const f = fixture(); await f.queue.setEnabled(true); await f.queue.enqueue([song('a')]); await f.queue.settled(); assert.equal(f.saved.jobs[0].status, 'completed'); assert.ok(!JSON.stringify(f.writes).includes('not-persisted')); assert.equal(f.writes[2].jobs[0].status, 'queued') })
  await check('duplicate source/id/quality/destination is not enqueued twice', async() => { const f = fixture(); await f.queue.setEnabled(true); await f.queue.enqueue([song('a'), song('a')]); await f.queue.settled(); await f.queue.enqueue([song('a')]); await f.queue.settled(); assert.equal(f.saved.jobs.length, 1); assert.equal(f.transfers.length, 1) })
  await check('different quality and destination are independent persistent jobs', async() => { const f = fixture(); await f.queue.setEnabled(true); await f.queue.enqueue([song('a')]); await f.queue.settled(); await f.queue.enqueue([song('a')], { kind: 'webdav', accountId: 'dav', path: 'music' }, 'flac'); await f.queue.settled(); assert.equal(f.saved.jobs.length, 2); assert.equal(f.saved.jobs[1].destination.kind, 'webdav') })
  await check('only one native transfer runs at a time', async() => {
    const f = fixture(), gates = [defer(), defer()]; let concurrent = 0, maximum = 0
    f.execute = async() => { const index = f.transfers.length - 1; maximum = Math.max(maximum, ++concurrent); await gates[index].promise; concurrent--; return result }
    await f.queue.setEnabled(true); await f.queue.enqueue([song('a'), song('b')]); await spin(() => f.transfers.length === 1); assert.equal(f.transfers.length, 1)
    gates[0].resolve(); await spin(() => f.transfers.length === 2); gates[1].resolve(); await f.queue.settled(); assert.equal(maximum, 1)
  })
  await check('pause while resolving cancels stale resolution before native work', async() => { const f = fixture(), gate = defer(); f.resolve = () => gate.promise; await f.queue.setEnabled(true); await f.queue.enqueue([song('a')]); await spin(() => f.resolved.length === 1); const paused = f.queue.pause(f.saved.jobs[0].id); gate.resolve({ kind: 'url', url: 'https://test.invalid/a' }); await paused; assert.equal(f.transfers.length, 0); assert.equal(f.saved.jobs[0].status, 'paused') })
  await check('pause active transfer waits for native checkpoint before publishing paused', async() => {
    const f = fixture(), gate = defer(); f.execute = () => gate.promise; f.cancel = () => gate.reject(Error('cancelled'))
    await f.queue.setEnabled(true); await f.queue.enqueue([song('a')]); await spin(() => f.transfers.length === 1); await f.queue.pause(f.saved.jobs[0].id)
    assert.equal(f.saved.jobs[0].status, 'paused'); assert.equal(f.cancellations.length, 1)
  })
  await check('late successful native result after cancellation does not falsely complete', async() => {
    const f = fixture(), gate = defer(); f.execute = () => gate.promise; f.cancel = () => gate.resolve(result)
    await f.queue.setEnabled(true); await f.queue.enqueue([song('a')]); await spin(() => f.transfers.length === 1); await f.queue.pause(f.saved.jobs[0].id); assert.equal(f.saved.jobs[0].status, 'paused')
  })
  await check('retry uses fresh operation and fresh URL resolution with same stable job id', async() => {
    const f = fixture(); f.execute = async() => { if (f.transfers.length === 1) throw Error('temporary'); return result }
    await f.queue.setEnabled(true); await f.queue.enqueue([song('a')]); await f.queue.settled(); const id = f.saved.jobs[0].id; assert.equal(f.saved.jobs[0].status, 'failed')
    await f.queue.retry(id); await f.queue.settled(); assert.equal(f.transfers.length, 2); assert.equal(f.transfers[0].job.id, f.transfers[1].job.id); assert.notEqual(f.transfers[0].operation, f.transfers[1].operation); assert.equal(f.resolved.length, 2)
  })
  await check('disabling cancels active work and pauses queued jobs', async() => {
    const f = fixture(), gate = defer(); f.execute = () => gate.promise; f.cancel = () => gate.reject(Error('cancelled'))
    await f.queue.setEnabled(true); await f.queue.enqueue([song('a'), song('b')]); await spin(() => f.transfers.length === 1); await f.queue.setEnabled(false)
    assert.equal(f.saved.enabled, false); assert.ok(f.saved.jobs.every(j => j.status === 'paused')); assert.equal(f.transfers.length, 1)
  })
  await check('snapshot hold cannot start queued work; release remains paused until user retry', async() => { const f = fixture(); await f.queue.setEnabled(true); const release = await f.queue.suspend(); await f.queue.enqueue([song('a')]); assert.equal(f.transfers.length, 0); await f.queue.pauseAll(); release(); await f.queue.settled(); assert.equal(f.transfers.length, 0); await f.queue.retry(f.saved.jobs[0].id); await f.queue.settled(); assert.equal(f.transfers.length, 1) })
  await check('persistence failure blocks new traffic and is visible without discarding existing records', async() => { const f = fixture(); await f.queue.setEnabled(true); f.failSave = true; await assert.rejects(f.queue.enqueue([song('a')])); assert.equal(f.transfers.length, 0); assert.equal(f.saved.jobs.length, 0); assert.match(f.queue.snapshot().error, /保存失败/); f.failSave = false; await f.queue.enqueue([song('a')]); await f.queue.settled(); assert.equal(f.saved.jobs[0].status, 'completed') })
  await check('remove record only discards its temporary partials, never a completed file', async() => { const f = fixture(); await f.queue.setEnabled(true); await f.queue.enqueue([song('a')]); await f.queue.settled(); const id = f.saved.jobs[0].id; await f.queue.remove(id); assert.deepEqual(f.partials, [id]); assert.equal(f.saved.jobs.length, 0) })
  await check('stale progress cannot change a new attempt or completed task', async() => { const f = fixture(); await f.queue.setEnabled(true); await f.queue.enqueue([song('a')]); await f.queue.settled(); f.queue.progress({ operationId: f.transfers[0].operation, phase: 'uploading', received: 999, total: 999 }); assert.equal(f.queue.snapshot().jobs[0].received, 100) })
  await check('native upload verification phase remains distinct from completed', async() => { const f = fixture(), gate = defer(); f.execute = () => gate.promise; await f.queue.setEnabled(true); await f.queue.enqueue([song('a')]); await spin(() => f.transfers.length === 1); f.queue.progress({ operationId: f.transfers[0].operation, phase: 'verifying', received: 70, total: 100 }); assert.equal(f.queue.snapshot().jobs[0].status, 'verifying'); gate.resolve(result); await f.queue.settled(); assert.equal(f.saved.jobs[0].status, 'completed') })
  await check('destination and quality configuration reject invalid options', async() => { const f = fixture(); await assert.rejects(f.queue.configure({ quality: 'unknown' })); await assert.rejects(f.queue.configure({ destination: { kind: 'webdav', accountId: '../x', path: '' } })); assert.equal(f.writes.length, 0) })
  await check('published receipt must have checksum and identity; incomplete receipt fails closed', async() => { const state = { ...newQueueState(), jobs: [{ id: 'a', music: song('a'), quality: '320k', destination: { kind: 'local' }, status: 'completed', received: 1, total: 1, created: 1 }] }; assert.throws(() => validateQueue(state)); state.jobs[0].result = result; assert.equal(validateQueue(state).jobs[0].result.sha256, result.sha256) })
  // Real storage wrapper: the sharded public writers must honor a held snapshot.
  await check('real AsyncStorage writers cannot interleave a held backup snapshot', async() => {
    const calls = [], store = new Map()
    const api = { getItem: async k => store.get(k) ?? null, multiGet: async keys => keys.map(k => [k, store.get(k) ?? null]), multiSet: async rows => { calls.push('write'); rows.forEach(([k,v]) => store.set(k,v)) }, removeItem: async k => { store.delete(k) }, multiRemove: async keys => keys.forEach(k => store.delete(k)), clear: async() => store.clear(), getAllKeys: async() => [...store.keys()] }
    const storage = load('src/plugins/storage.ts', { '@react-native-async-storage/async-storage': { default: api }, '@/utils/log': { log: { error() {} } } })
    await storage.saveData('first', { n: 1 }); const gate = defer(), entered = defer()
    const snapshot = storage.withStorageSnapshot(async() => { entered.resolve(); await gate.promise; assert.equal(store.has('second'), false) }); await entered.promise
    const write = storage.saveData('second', 'x'.repeat(600001)); await new Promise(r => setTimeout(r, 5)); assert.equal(calls.length, 1); gate.resolve(); await snapshot; await write
    assert.equal(await storage.getData('second'), 'x'.repeat(600001))
  })
  console.log(`${count} library state/storage checks passed; native/network integration is a separate required gate.`)
})().catch(error => { console.error(error); process.exitCode = 1 })
