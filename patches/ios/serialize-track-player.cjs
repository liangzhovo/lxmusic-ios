// Keep React Native exports on their default serial module queue and defer
// SwiftAudio observer work away from AVFoundation callbacks. This does not
// change decoders, buffering policy, volume, seek semantics or cache data.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const QUEUE_MARKER = '// LX_DEFAULT_REACT_NATIVE_PLAYBACK_QUEUE_V2'
const LIFECYCLE_MARKER = '// LX_DEFER_LIFECYCLE_SNAPSHOT_V1'
const MIX_MARKER = '// LX_ORDER_AUDIO_MIX_BEFORE_PLAY_V2'

function bridge(source) {
  if (source.includes(QUEUE_MARKER)) return source
  const anchor = '@interface RCT_EXTERN_REMAP_MODULE(TrackPlayerModule, RNTrackPlayer, NSObject)'
  assert.equal(source.split(anchor).length, 2, 'Unexpected TrackPlayer bridge: queue anchor must be unique')
  assert.ok(!source.includes('methodQueue'), 'Review existing TrackPlayer queue before replacing it')
  // Do not add a methodQueue override. React Native supplies a private serial
  // module queue for these exports. AVPlayer.currentTime() can synchronously
  // wait for AVFoundation while a remote item is being opened; moving that call
  // to the main queue starves the callbacks that advance the same player.
  return source.replace(anchor, anchor + `

${QUEUE_MARKER}
// Keep React Native's default serial module queue. AVFoundation observer work
// is separately deferred by the installed SwiftAudio patch.
`)
}
function swift(source) {
  let result = source
  if (!result.includes(LIFECYCLE_MARKER)) {
    const expression = /    private func postLifecycleEvent\(_ event: String,[\s\S]*?\n    }\n/
    assert.equal((result.match(new RegExp(expression.source, 'g')) || []).length, 1, 'Unexpected lifecycle function')
    result = result.replace(expression, `    private func postLifecycleEvent(_ event: String, state: AVPlayerWrapperState? = nil, position: Double? = nil, rate: Float? = nil, extra: [String: Any] = [:]) {
        ${LIFECYCLE_MARKER}
        // AVFoundation/KVO callbacks can arrive while a player lock is held.
        // Do not synchronously query the timeline or wait for a main-queue
        // NotificationCenter observer from inside that callback.
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            var userInfo = extra
            userInfo["event"] = event
            userInfo["state"] = self.lifecycleStateName(state ?? self.player.playerState)
            // Only seek notifications consume a timeline value in AppDelegate.
            // State/error notifications must not synchronously read AVPlayer time.
            if let position = position { userInfo["position"] = position }
            if let rate = rate { userInfo["rate"] = rate }
            userInfo["track"] = self.player.currentIndex
            NotificationCenter.default.post(name: lxTrackPlayerLifecycleNotification, object: self, userInfo: userInfo)
        }
    }
`)
  }
  if (!result.includes(MIX_MARKER)) {
    const expression = /    private func refreshSoundEffectAudioMixOnMainThread\(\) \{[\s\S]*?\n    }\n/
    assert.equal((result.match(new RegExp(expression.source, 'g')) || []).length, 1, 'Unexpected sound-effect refresh function')
    result = result.replace(expression, `    private func refreshSoundEffectAudioMixOnMainThread() {
        ${MIX_MARKER}
        // SwiftAudio's ready-state delegate runs before its playWhenReady call.
        // Once that delegate is already on main, configure the audio mix before
        // returning so AVPlayer does not start and then get its audioMix changed.
        // Non-main state callbacks still hop asynchronously to main.
        if Thread.isMainThread {
            refreshSoundEffectAudioMix()
            return
        }
        DispatchQueue.main.async { [weak self] in
            self?.refreshSoundEffectAudioMix()
        }
    }
`)
  }
  return result
}
function apply(root) {
  const base = path.join(root, 'node_modules/react-native-track-player/ios/RNTrackPlayer')
  for (const [name, transform] of [['RNTrackPlayerBridge.m', bridge], ['RNTrackPlayer.swift', swift]]) {
    const file = path.join(base, name)
    const previous = fs.readFileSync(file, 'utf8')
    const next = transform(previous)
    if (previous !== next) fs.writeFileSync(file, next)
    console.log('Verified serial iOS playback patch: ' + name)
  }
}
module.exports = { apply, bridge, swift, QUEUE_MARKER, LIFECYCLE_MARKER, MIX_MARKER }
if (require.main === module) apply(path.resolve(__dirname, '../..'))
