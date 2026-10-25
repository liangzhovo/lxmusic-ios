const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')

const MARKER = '// LX_SWIFT_AUDIO_POSITION_CACHE_V1'

function replaceExactlyOnce(source, pattern, replacement, label) {
  const flags = pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g'
  const count = [...source.matchAll(new RegExp(pattern.source, flags))].length
  assert.equal(count, 1, `${label}: expected exactly one source anchor, found ${count}`)
  return source.replace(pattern, replacement)
}

function transform(source) {
  if (source.includes(MARKER)) {
    assert.equal(source.split(MARKER).length, 2, 'position cache marker duplicated')
    assert.ok(source.includes('return lxCachedCurrentTime'))
    assert.ok(source.includes('lxSetCachedCurrentTime(time.seconds)'))
    assert.ok(!/var currentTime: TimeInterval \{\s*let seconds = avPlayer\.currentTime\(\)\.seconds/.test(source))
    return source
  }

  let next = source
  next = replaceExactlyOnce(
    next,
    /    var currentTime: TimeInterval \{\n        let seconds = avPlayer\.currentTime\(\)\.seconds\n        return seconds\.isNaN \? 0 : seconds\n    \}/,
    `    ${MARKER}\n    private let lxCurrentTimeLock = NSLock()\n    private var lxCachedCurrentTime: TimeInterval = 0\n\n    private func lxSetCachedCurrentTime(_ seconds: TimeInterval) {\n        guard seconds.isFinite && seconds >= 0 else { return }\n        lxCurrentTimeLock.lock()\n        lxCachedCurrentTime = seconds\n        lxCurrentTimeLock.unlock()\n    }\n\n    var currentTime: TimeInterval {\n        lxCurrentTimeLock.lock()\n        defer { lxCurrentTimeLock.unlock() }\n        return lxCachedCurrentTime\n    }`,
    'currentTime property',
  )

  next = replaceExactlyOnce(
    next,
    /(    func seek\(to seconds: TimeInterval\) \{\n)/,
    `$1        lxSetCachedCurrentTime(seconds)\n`,
    'seek entry',
  )

  next = replaceExactlyOnce(
    next,
    /(    private func reset\(soft: Bool\) \{\n)/,
    `$1        lxSetCachedCurrentTime(0)\n`,
    'reset entry',
  )

  next = replaceExactlyOnce(
    next,
    /    func timeEvent\(time: CMTime\) \{\n        self\.delegate\?\.AVWrapper\(secondsElapsed: time\.seconds\)\n    \}/,
    `    func timeEvent(time: CMTime) {\n        lxSetCachedCurrentTime(time.seconds)\n        self.delegate?.AVWrapper(secondsElapsed: time.seconds)\n    }`,
    'periodic time callback',
  )

  // Reset at the exact AVPlayerItem replacement point too. During an async
  // remote load the old item may remain installed after reset(soft: true).
  // This anchor lives inside DispatchQueue.main.async in SwiftAudioEx 0.14.7,
  // so Swift requires an explicit self reference for the helper call.
  next = replaceExactlyOnce(
    next,
    /(                            self\.avPlayer\.replaceCurrentItem\(with: currentItem\)\n)/,
    `                            self.lxSetCachedCurrentTime(0)\n$1`,
    'item replacement',
  )

  assert.ok(!/var currentTime: TimeInterval \{\s*let seconds = avPlayer\.currentTime\(\)\.seconds/.test(next), 'blocking currentTime property remains')
  return next
}

function findWrapper(root) {
  const stack = [root]
  const matches = []
  while (stack.length) {
    const dir = stack.pop()
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else if (entry.name === 'AVPlayerWrapper.swift' && /SwiftAudio/i.test(full)) matches.push(full)
    }
  }
  assert.equal(matches.length, 1, `expected one SwiftAudio AVPlayerWrapper.swift, found ${matches.length}`)
  return matches[0]
}

function apply(root) {
  const file = findWrapper(root)
  const source = fs.readFileSync(file, 'utf8')
  const next = transform(source)
  if (source !== next) fs.writeFileSync(file, next)
  assert.equal(fs.readFileSync(file, 'utf8'), next)
  console.log('Verified SwiftAudio periodic position cache: ' + file)
}

module.exports = { transform, apply, MARKER }
if (require.main === module) apply(path.resolve(process.argv[2] || path.join(__dirname, '../../ios/Pods')))
