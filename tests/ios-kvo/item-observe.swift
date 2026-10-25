// Extracted KVO switch from SwiftAudioEx 0.14.7 AVPlayerItemObserver.swift
// Upstream blob bcb87cb37332bb0c61022366bb02008d47102d1c (MIT).
    override func observeValue(forKeyPath keyPath: String?, of object: Any?, change: [NSKeyValueChangeKey : Any]?, context: UnsafeMutableRawPointer?) {
        guard context == &AVPlayerItemObserver.context, let observedKeyPath = keyPath else {
            super.observeValue(forKeyPath: keyPath, of: object, change: change, context: context)
            return
        }
        switch observedKeyPath {
        case AVPlayerItemKeyPath.duration:
            if let duration = change?[.newKey] as? CMTime {
                self.delegate?.item(didUpdateDuration: duration.seconds)
            }
        case AVPlayerItemKeyPath.loadedTimeRanges:
            if let ranges = change?[.newKey] as? [NSValue], let duration = ranges.first?.timeRangeValue.duration {
                self.delegate?.item(didUpdateDuration: duration.seconds)
            }
        case AVPlayerItemKeyPath.timedMetadata:
            if let metadata = change?[.newKey] as? [AVMetadataItem] {
                self.delegate?.item(didReceiveMetadata: metadata)
            }
        default: break
        }
    }
