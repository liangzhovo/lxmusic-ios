// Extracted KVO switch from SwiftAudioEx 0.14.7 AVPlayerObserver.swift
// Upstream blob e0536f2b018128ee8c7c58052ae7ae6391c98086 (MIT).
    override func observeValue(forKeyPath keyPath: String?, of object: Any?, change: [NSKeyValueChangeKey : Any]?, context: UnsafeMutableRawPointer?) {
        guard context == &AVPlayerObserver.context, let observedKeyPath = keyPath else {
            super.observeValue(forKeyPath: keyPath, of: object, change: change, context: context)
            return
        }
        switch observedKeyPath {
        case AVPlayerKeyPath.status:
            self.handleStatusChange(change)
        case AVPlayerKeyPath.timeControlStatus:
            self.handleTimeControlStatusChange(change)
        default:
            break
        }
    }
