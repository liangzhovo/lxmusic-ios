const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const assert = require('node:assert/strict'), { spawnSync } = require('node:child_process')
const { transform, tracePosition, MARKER } = require('../patches/ios/defer-swift-audio-kvo.cjs')
const root = path.resolve(__dirname, '..'), read = file => fs.readFileSync(path.join(root, file), 'utf8')
const player = read('tests/ios-kvo/player-observe.swift'), item = read('tests/ios-kvo/item-observe.swift')
for (const [source, kind] of [[player, 'AVPlayerObserver'], [item, 'AVPlayerItemObserver']]) {
  const result = transform(source, kind)
  assert.ok(result.includes(MARKER))
  assert.equal(transform(result, kind), result)
  assert.throws(() => transform(source + source, kind))
  assert.throws(() => transform('changed dependency', kind))
  assert.throws(() => transform(source.replace('guard context', 'guard other'), kind))
}
assert.ok(read('ios/Podfile').includes("raise 'SwiftAudio KVO patch failed' unless system('node', kvo_patch, installer.sandbox.root.to_s)"))
const position = `    public func getPosition(resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
        resolve(player.currentTime)
    }`
const traced = tracePosition(position)
assert.equal(tracePosition(traced), traced)
assert.throws(() => tracePosition('changed dependency'))
assert.throws(() => tracePosition(position + position))
assert.ok(traced.includes('let position = player.currentTime') && traced.includes('resolve(position)'))
assert.ok(traced.includes('LX_NATIVE_POSITION enter main=%@'))
assert.ok(traced.indexOf('LX_NATIVE_POSITION enter') < traced.indexOf('let position ='))
assert.ok(traced.indexOf('LX_NATIVE_POSITION exit') > traced.indexOf('let position ='))
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-kvo-'))
const run = (command, args, timeout = 60000) => {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout, cwd: directory, maxBuffer: 2 * 1024 * 1024 })
  assert.ifError(result.error)
  return result
}
try {
  for (const patched of [false, true]) {
    const p = patched ? transform(player, 'AVPlayerObserver') : player
    const i = patched ? transform(item, 'AVPlayerItemObserver') : item
    const source = read('tests/ios-kvo/harness.swift').replace('// PLAYER_BODY', p).replace('// ITEM_BODY', i)
      .replaceAll('NSKeyValueChangeKey', 'KVOKey').replaceAll('[NSValue]', '[FakeValue]')
    const name = patched ? 'deferred' : 'inline'
    fs.writeFileSync(path.join(directory, name + '.swift'), source)
    const compiler = run('swiftc', ['-swift-version', '5', name + '.swift', '-o', name])
    assert.equal(compiler.status, 0, compiler.stdout + compiler.stderr)
    const process = run(path.join(directory, name), [], 5000)
    if (patched) {
      assert.equal(process.status, 0, process.stdout + process.stderr)
      console.log(process.stdout.trim())
    } else {
      assert.notEqual(process.status, 0, 'The original inline delegate must fail the reentry test')
      assert.ok(process.stderr.includes('inline KVO reentry'), process.stderr)
      console.log('PASS original inline callback is rejected by the same executable regression')
    }
  }
} finally { fs.rmSync(directory, { recursive: true, force: true }) }
console.log('PASS pinned KVO anchors, idempotency, unknown-source rejection and CocoaPods integration')
