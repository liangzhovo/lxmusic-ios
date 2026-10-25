// Test fixture only. Observe endpoint/status/timing; never request headers,
// auth payloads, socket tokens, server ids, client ids, or response bodies.
const allowed = new Set(['/hello', '/id', '/ah', '/socket'])
function createAudit(clock = Date.now) {
  const events = []
  let sequence = 0
  function observe(req, res) {
    const endpoint = String(req.url || '').split('?')[0]
    const entry = { sequence: ++sequence, endpoint: allowed.has(endpoint) ? endpoint : '[other]',
      method: ['GET', 'POST', 'OPTIONS'].includes(req.method) ? req.method : '[other]', started: clock() }
    events.push(entry)
    if (events.length > 256) events.shift()
    let settled = false
    const finish = closed => {
      if (settled) return
      settled = true
      entry.elapsedMs = Math.max(0, clock() - entry.started)
      entry.status = res.statusCode
      entry.closedEarly = closed
    }
    res.once('finish', () => finish(false))
    res.once('close', () => finish(!res.writableFinished))
  }
  return { observe, snapshot: () => events.map(entry => ({ ...entry })) }
}
async function verifyProtocol(base, request = fetch) {
  const hello = await request(base + '/hello', { signal: AbortSignal.timeout(2000) })
  if (hello.status !== 200 || await hello.text() !== 'Hello~::^-^::~v4~') {
    throw new Error('Fixture protocol /hello is not ready (HTTP ' + hello.status + ')')
  }
  const identity = await request(base + '/id', { signal: AbortSignal.timeout(2000) })
  if (identity.status !== 200 || !/^OjppZDo6.+/.test(await identity.text())) {
    throw new Error('Fixture protocol /id is not ready (HTTP ' + identity.status + ')')
  }
  return { ok: true, protocol: 'v4', protocolReady: true }
}
module.exports = { createAudit, verifyProtocol }
