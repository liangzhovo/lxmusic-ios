// Execute assertion code and passive HTTP observer; fail-closed on unexpected
// errors, preserve underlying failures, and forbid credential capture.
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm')
const path = require('node:path'), http = require('node:http'), ts = require('typescript')
const { createAudit, verifyProtocol } = require('./sync-fixture-audit.cjs')
const root = path.resolve(__dirname, '..')
const result = ts.transpileModule(fs.readFileSync(path.join(root, 'src/tests/expectedSyncFailure.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, reportDiagnostics: true,
})
assert.equal(result.diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error).length, 0)
const exported = {}; vm.runInNewContext(result.outputText, { exports: exported, Error, String })
const { expectSyncFailure } = exported
const context = () => ({ status: { status: false, message: 'Network request failed' }, diagnostic: 'sync /hello' })
let count = 0
async function check(label, work) { await work(); count++; console.log('PASS ' + label) }
;(async() => {
  await check('expected protocol errors pass and are recorded', async() => {
    for (const message of ['Missing auth code', 'Auth failed']) {
      const result = await expectSyncFailure(async() => { throw new Error(message) }, message, context)
      assert.equal(result.received, message); assert.equal(result.expected, message)
    }
  })
  await check('resolved cancellation cannot pass an expected failure', async() => {
    await assert.rejects(expectSyncFailure(async() => {}, 'Missing auth code', context), /resolved without rejection/)
  })
  await check('network/native/protocol errors retain actual cause and stage', async() => {
    for (const message of ['Network request failed', 'HTTP 503', 'Native storage unavailable']) {
      const error = Object.assign(new TypeError(message), { syncStage: '/hello' })
      await assert.rejects(expectSyncFailure(async() => { throw error }, 'Missing auth code', context), e =>
        e.message.includes('actual=' + message) && e.message.includes('stage=/hello') && e.message.includes('diagnostic=sync /hello'))
    }
  })
  await check('embedded expected text and non-error rejections cannot spoof success', async() => {
    for (const failure of [undefined, null, 'Unrelated Missing auth code', new Error('Unexpected Missing auth code')]) {
      await assert.rejects(expectSyncFailure(async() => { throw failure }, 'Missing auth code', context))
    }
  })
  await check('diagnostics redact URLs and secret-shaped content', async() => {
    const secret = 'never-log-this-value'
    await assert.rejects(expectSyncFailure(async() => { throw new Error('https://user:secret@host/ password=' + secret) },
      'Missing auth code', () => ({ status: { status: false, message: 'token=' + secret }, diagnostic: 'authorization=' + secret })), e => {
      assert.ok(!e.message.includes(secret)); assert.ok(!e.message.includes('user:secret')); return true
    })
  })
  const audit = createAudit()
  let badHello = false, badIdentity = false
  const server = http.createServer((req, res) => {
    audit.observe(req, res)
    const endpoint = req.url.split('?')[0]
    if (endpoint === '/hello') { res.statusCode = badHello ? 503 : 200; res.end(badHello ? 'not ready' : 'Hello~::^-^::~v4~') }
    else if (endpoint === '/id') res.end(badIdentity ? 'bad' : 'OjppZDo6fixture-id')
    else { res.statusCode = 401; res.end('Auth failed') }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = 'http://127.0.0.1:' + server.address().port
  try {
    await check('health probes actual hello and id on a real HTTP service', async() => {
      assert.deepEqual(await verifyProtocol(base), { ok: true, protocol: 'v4', protocolReady: true })
      assert.deepEqual(audit.snapshot().map(e => e.endpoint), ['/hello', '/id'])
    })
    await check('HTTP unavailable, wrong protocol, and invalid server id remain failures', async() => {
      badHello = true; await assert.rejects(verifyProtocol(base), /\/hello/); badHello = false
      badIdentity = true; await assert.rejects(verifyProtocol(base), /\/id/); badIdentity = false
      await assert.rejects(verifyProtocol(base, async() => ({ status: 200, text: async() => 'Hello~::^-^::~v5~' })), /\/hello/)
    })
    await check('passive observer records status but not tokens or request/response bodies', async() => {
      const token = 'never-log-auth-value'
      await (await fetch(base + '/ah?token=' + token, { headers: { authorization: token, m: token } })).text()
      await (await fetch(base + '/' + token)).text()
      const entries = audit.snapshot(), encoded = JSON.stringify(entries)
      assert.ok(!encoded.includes(token)); assert.ok(!encoded.includes('fixture-id'))
      assert.equal(entries.at(-2).endpoint, '/ah'); assert.equal(entries.at(-2).status, 401)
      assert.equal(entries.at(-1).endpoint, '[other]'); assert.ok(entries.every(e => e.elapsedMs >= 0 && !e.closedEarly))
      entries[0].endpoint = 'tamper'; assert.notEqual(audit.snapshot()[0].endpoint, 'tamper')
    })
    await check('audit memory is bounded without retaining previous request objects', () => {
      const { EventEmitter } = require('node:events')
      const bounded = createAudit()
      for (let i = 0; i < 300; i++) { const response = new EventEmitter(); response.statusCode = 200; response.writableFinished = true
        bounded.observe({ url: '/hello', method: 'GET' }, response); response.emit('finish') }
      assert.equal(bounded.snapshot().length, 256); assert.equal(bounded.snapshot().at(-1).sequence, 300)
    })
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
  await check('native smoke uses fail-closed assertions and keeps pairing/reconnect/online-offline gates', () => {
    const smoke = fs.readFileSync(path.join(root, 'src/tests/syncSmoke.ts'), 'utf8')
    assert.ok(smoke.includes('expectSyncFailure(() => connectServer(address), SYNC_CODE.missingAuthCode, context)'))
    assert.ok(smoke.includes("expectSyncFailure(() => connectServer(address, 'wrong-local-ci-code'), SYNC_CODE.authFailed, context)"))
    for (const text of ['independent desktop protocol peer', 'abnormal connection loss', 'durable key reconnect', 'cold process recovers pairing']) assert.ok(smoke.includes(text))
    const driver = fs.readFileSync(path.join(root, 'scripts/run-ios-playback-smoke.py'), 'utf8')
    assert.ok(driver.includes("sync-http-diagnostics.json")); assert.ok(driver.includes('if len(inventory) != 54:'))
    assert.ok(driver.includes('if native_failures:')); assert.ok(driver.includes('offline_prerequisite(online_report)'))
  })
  console.log(count + ' sync smoke diagnostics checks passed; no native result is asserted here.')
})().catch(error => { console.error(error); process.exitCode = 1 })
