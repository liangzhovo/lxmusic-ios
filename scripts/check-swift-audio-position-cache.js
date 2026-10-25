const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { transform, MARKER } = require('../patches/ios/cache-swift-audio-position.cjs')

// Anchors copied from the pinned SwiftAudioEx 0.14.7 wrapper. The seek body is
// deliberately represented by the post_install variant because that patch runs first.
const fixture = `import Foundation
import AVFoundation
class AVPlayerWrapper {
    var avPlayer: AVPlayer
    var currentTime: TimeInterval {
        let seconds = avPlayer.currentTime().seconds
        return seconds.isNaN ? 0 : seconds
    }
    func seek(to seconds: TimeInterval) {
        if (avPlayer.currentItem == nil) {
            timeToSeekToAfterLoading = seconds
        } else {
            avPlayer.seek(to: CMTimeMakeWithSeconds(seconds, preferredTimescale: 1000))
        }
    }
    private func reset(soft: Bool) {
        playerItemObserver.stopObservingCurrentItem()
    }
    func loadAsset(_ currentItem: AVPlayerItem) {
                            self.avPlayer.replaceCurrentItem(with: currentItem)
    }
    func timeEvent(time: CMTime) {
        self.delegate?.AVWrapper(secondsElapsed: time.seconds)
    }
}`

const result = transform(fixture)
assert.ok(result.includes(MARKER))
assert.equal(transform(result), result)
assert.ok(result.includes('private let lxCurrentTimeLock = NSLock()'))
assert.ok(result.includes('return lxCachedCurrentTime'))
assert.ok(result.includes('lxSetCachedCurrentTime(seconds)'))
assert.ok(result.includes('lxSetCachedCurrentTime(time.seconds)'))
assert.ok(result.includes('self.lxSetCachedCurrentTime(0)\n                            self.avPlayer.replaceCurrentItem'))
assert.ok(!result.includes('                            lxSetCachedCurrentTime(0)\n                            self.avPlayer.replaceCurrentItem'))
assert.ok(!result.includes('let seconds = avPlayer.currentTime().seconds'))
assert.throws(() => transform('changed dependency'))
assert.throws(() => transform(fixture + fixture))

const podfile = fs.readFileSync(path.join(__dirname, '..', 'ios/Podfile'), 'utf8')
assert.ok(podfile.includes("cache-swift-audio-position.cjs"))
assert.ok(podfile.includes("raise 'SwiftAudio position cache patch failed'"))
assert.ok(podfile.indexOf('lx_patch_swift_audio_seek(installer)') < podfile.lastIndexOf("cache-swift-audio-position.cjs"))
const smoke = fs.readFileSync(path.join(__dirname, '..', 'src/tests/playbackSmoke.tsx'), 'utf8')
assert.ok(smoke.includes("bounded(getPosition(), 'getPosition', 3000)"))
assert.ok(smoke.includes('(await position()) > initial + 0.25'))
assert.ok(!smoke.includes("bounded(getPosition(), 'getPosition', 5000)"))
console.log('PASS SwiftAudio currentTime is sourced from real AVPlayer periodic CMTime; closure reset uses explicit self; 3000 ms playback gate is unchanged')
