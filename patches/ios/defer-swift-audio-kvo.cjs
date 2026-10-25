// SwiftAudioEx 0.14.7 delivers KVO delegates inline on AVFoundation's caller.
// Leave that callback before querying/mutating AVPlayer or notifying main-queue
// consumers. The TrackPlayer bridge's methodQueue does not move these callbacks.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const MARKER = '// LX_DEFER_SWIFT_AUDIO_KVO_V1'

function transform(source, kind) {
  assert.ok(['AVPlayerObserver', 'AVPlayerItemObserver'].includes(kind), 'Unknown observer')
  const marker = MARKER + ':' + kind
  if (source.includes(marker)) {
    assert.equal(source.split(marker).length, 2, 'Duplicate KVO patch')
    assert.ok(source.includes('DispatchQueue.main.async { [weak self, weak observed] in'))
    assert.ok(source.includes(kind === 'AVPlayerObserver' ? 'self.player === observed' : 'self.observingItem === observed'))
    return source
  }
  const begin = source.indexOf('        switch observedKeyPath {')
  assert.ok(begin >= 0 && source.indexOf('        switch observedKeyPath {', begin + 1) < 0, 'Unknown or duplicate KVO switch')
  assert.ok(source.slice(0, begin).includes('guard context == &' + kind + '.context'), 'KVO context guard missing')
  let depth = 0, end = begin
  for (let i = source.indexOf('{', begin); i < source.length; i++) {
    if (source[i] === '{') depth++
    if (source[i] === '}' && --depth === 0) { end = i + 1; break }
  }
  assert.ok(end > begin, 'Unbalanced KVO switch')
  const original = source.slice(begin, end)
  let body
  if (kind === 'AVPlayerObserver') {
    assert.ok(original.includes('self.handleStatusChange(change)') && original.includes('self.handleTimeControlStatusChange(change)'), 'Unknown player delegate paths')
    // Read current values AFTER the callback returns. Queued notifications from
    // a previous observation must not restore a stale ready/paused state.
    body = `        switch observedKeyPath {
        case AVPlayerKeyPath.status:
            self.handleStatusChange([.newKey: NSNumber(value: observed.status.rawValue)])
        case AVPlayerKeyPath.timeControlStatus:
            self.handleTimeControlStatusChange([.newKey: NSNumber(value: observed.timeControlStatus.rawValue)])
        default: break
        }`
  } else {
    assert.ok(original.includes('didUpdateDuration: duration.seconds') && original.includes('didReceiveMetadata: metadata'), 'Unknown item delegate paths')
    body = original
  }
  const type = kind === 'AVPlayerObserver' ? 'AVPlayer' : 'AVPlayerItem'
  const property = kind === 'AVPlayerObserver' ? 'player' : 'observingItem'
  const replacement = `        ${marker}
        guard let observed = object as? ${type} else { return }
        DispatchQueue.main.async { [weak self, weak observed] in
            guard let self = self, let observed = observed,
                  self.isObserving, self.${property} === observed else { return }
${body.split('\n').map(line => '    ' + line).join('\n')}
        }`
  return source.slice(0, begin) + replacement + source.slice(end)
}

function tracePosition(source) {
  const marker = '// LX_NATIVE_POSITION_TRACE_V1'
  if (source.includes(marker)) {
    assert.ok(source.includes('LX_NATIVE_POSITION enter') && source.includes('LX_NATIVE_POSITION exit'))
    return source
  }
  const original = `    public func getPosition(resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
        resolve(player.currentTime)
    }`
  assert.equal(source.split(original).length, 2, 'Unknown native position function')
  return source.replace(original, `    public func getPosition(resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
        ${marker}
        #if targetEnvironment(simulator)
        NSLog("LX_NATIVE_POSITION enter main=%@", Thread.isMainThread ? "yes" : "no")
        #endif
        let position = player.currentTime
        #if targetEnvironment(simulator)
        NSLog("LX_NATIVE_POSITION exit value=%f", position)
        #endif
        resolve(position)
    }`)
}

function apply(pods) {
  const folder = path.join(pods, 'SwiftAudioEx/SwiftAudioEx/Classes/Observer')
  const evidence = []
  // Prepare both transformations before changing either installed source.
  const changes = ['AVPlayerObserver', 'AVPlayerItemObserver'].map(kind => {
    const file = path.join(folder, kind + '.swift')
    const source = fs.readFileSync(file, 'utf8')
    return { file, source, next: transform(source, kind) }
  })
  const trackPlayerFile = path.resolve(pods, '../../node_modules/react-native-track-player/ios/RNTrackPlayer/RNTrackPlayer.swift')
  const trackPlayer = fs.readFileSync(trackPlayerFile, 'utf8')
  changes.push({ file: trackPlayerFile, source: trackPlayer, next: tracePosition(trackPlayer) })
  for (const { file, source, next } of changes) {
    if (source !== next) fs.writeFileSync(file, next)
    assert.equal(fs.readFileSync(file, 'utf8'), next)
    evidence.push({ file: path.relative(pods, file), sha256: crypto.createHash('sha256').update(next).digest('hex') })
    console.log('Verified deferred SwiftAudio KVO: ' + path.basename(file))
  }
  const reports = path.resolve(__dirname, '../../build/checks')
  fs.mkdirSync(reports, { recursive: true })
  fs.writeFileSync(path.join(reports, 'swift-audio-kvo.json'), JSON.stringify({ dependency: 'SwiftAudioEx 0.14.7', files: evidence }, null, 2))
}
module.exports = { transform, tracePosition, apply, MARKER }
if (require.main === module) apply(path.resolve(process.argv[2] || path.join(__dirname, '../../ios/Pods')))
