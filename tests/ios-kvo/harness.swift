// Executes the production patch's transformed Swift callback bodies against
// controlled values. AVFoundation integration remains a separate native gate.
import Foundation
import Dispatch
#if canImport(Glibc)
import Glibc
#else
import Darwin
#endif
struct KVOKey: Hashable { let value: Int; static let newKey = KVOKey(value: 1) }
struct CMTime { let seconds: Double }
struct FakeRange { let duration: CMTime }
struct FakeValue { let timeRangeValue: FakeRange }
class AVMetadataItem {}
class AVPlayer { enum State: Int { case unknown, ready, failed }; var status = State.ready; var timeControlStatus = State.ready }
class AVPlayerItem {}
let mainKey = DispatchSpecificKey<String>()
DispatchQueue.main.setSpecific(key: mainKey, value: "playback")
var insideKVO = false
var received: [String] = []
func record(_ value: String) {
    if insideKVO { fputs("inline KVO reentry\n", stderr); exit(86) }
    precondition(DispatchQueue.getSpecific(key: mainKey) == "playback", "wrong playback queue")
    received.append(value)
}
class Base {
    func observeValue(forKeyPath keyPath: String?, of object: Any?, change: [KVOKey: Any]?, context: UnsafeMutableRawPointer?) {}
}
class AVPlayerObserver: Base {
    static var context = 0
    var isObserving = true
    weak var player: AVPlayer?
    enum AVPlayerKeyPath { static let status = "status"; static let timeControlStatus = "timeControlStatus" }
    func handleStatusChange(_ change: [KVOKey: Any]?) { record("status:\((change?[.newKey] as! NSNumber).intValue)") }
    func handleTimeControlStatusChange(_ change: [KVOKey: Any]?) { record("control:\((change?[.newKey] as! NSNumber).intValue)") }
    func receive(_ key: String, _ value: Int, _ object: AVPlayer) {
        insideKVO = true
        observeValue(forKeyPath: key, of: object, change: [.newKey: NSNumber(value: value)], context: &AVPlayerObserver.context)
        insideKVO = false
    }
    // PLAYER_BODY
}
class ItemDelegate {
    func item(didUpdateDuration duration: Double) { record("duration:\(Int(duration))") }
    func item(didReceiveMetadata metadata: [AVMetadataItem]) { record("metadata:\(metadata.count)") }
}
class AVPlayerItemObserver: Base {
    static var context = 0
    var isObserving = true
    weak var observingItem: AVPlayerItem?
    var delegate: ItemDelegate? = ItemDelegate()
    enum AVPlayerItemKeyPath { static let duration = "duration"; static let loadedTimeRanges = "loadedTimeRanges"; static let timedMetadata = "timedMetadata" }
    func receive(_ key: String, _ value: Any, _ object: AVPlayerItem) {
        insideKVO = true
        observeValue(forKeyPath: key, of: object, change: [.newKey: value], context: &AVPlayerItemObserver.context)
        insideKVO = false
    }
    // ITEM_BODY
}
let player = AVPlayer(), replacement = AVPlayer(), oldItem = AVPlayerItem(), newItem = AVPlayerItem()
let observer = AVPlayerObserver(), itemObserver = AVPlayerItemObserver()
observer.player = player; itemObserver.observingItem = oldItem
observer.receive("status", 1, player)
player.status = .failed // must read the latest state, not replay stale ready
itemObserver.receive("duration", CMTime(seconds: 7), oldItem)
itemObserver.observingItem = newItem // stale item's pending callback must drop
precondition(received.isEmpty, "callback was not deferred")
DispatchQueue.main.async {
    precondition(received == ["status:2"], "stale state or stale item delivered: \(received)")
    itemObserver.receive("duration", CMTime(seconds: 12), newItem)
    itemObserver.receive("timedMetadata", [AVMetadataItem()], newItem)
    itemObserver.receive("loadedTimeRanges", [FakeValue(timeRangeValue: FakeRange(duration: CMTime(seconds: 19)))], newItem)
    observer.receive("timeControlStatus", 1, player)
    observer.player = replacement // old player event must drop
    precondition(received == ["status:2"], "main-thread KVO reentered")
    DispatchQueue.main.async {
        precondition(received == ["status:2", "duration:12", "metadata:1", "duration:19"], "wrong callback values: \(received)")
        itemObserver.receive("duration", CMTime(seconds: 99), newItem)
        itemObserver.isObserving = false
        DispatchQueue.main.async {
            precondition(received.count == 4, "stopped observer delivered pending event")
            print("PASS deferred main-queue callbacks, current player state, stale player/item rejection, duration, ranges, metadata and stop")
            exit(0)
        }
    }
}
dispatchMain()
