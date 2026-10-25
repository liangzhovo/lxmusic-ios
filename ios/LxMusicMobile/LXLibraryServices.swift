import Foundation
import React

@objc(LXLibraryServices)
final class LXLibraryServices: RCTEventEmitter {
  private let registry = LXOperationRegistry()
  private var worker: LXLibraryWorker?
  private let lock = NSLock()
  private var listening = false
  override static func requiresMainQueueSetup() -> Bool { false }
  override func supportedEvents() -> [String]! { ["LXLibraryProgress"] }
  override func startObserving() { listening = true }
  override func stopObserving() { listening = false }
  private func getWorker() throws -> LXLibraryWorker {
    lock.lock(); defer { lock.unlock() }
    if let w = worker { return w }
    let w = try LXLibraryWorker(restore: LXRestoreBootstrap.coordinator(), registry: registry); worker = w; return w
  }
  @objc(cancel:)
  func cancel(_ operation: String) { registry.cancel(operation) }
  @objc(command:payload:resolver:rejecter:)
  func command(_ action: String, payload: NSDictionary, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    let p = payload as? [String: Any] ?? [:], operation = p["operationId"] as? String ?? ""
    Task {
      do {
        let worker = try self.getWorker()
        let result = try await worker.command(action, p) { [weak self] phase, received, total in
          DispatchQueue.main.async {
            guard let self = self, self.listening else { return }
            self.sendEvent(withName: "LXLibraryProgress", body: ["operationId": operation, "phase": phase, "received": received, "total": total])
          }
        }
        resolve(result)
      } catch {
        let message: String
        if let e = error as? LXLibraryError { message = e.message }
        else if let e = error as? LXDALError { message = e.localizedDescription }
        else if let e = error as? LXTransferError { message = e.localizedDescription }
        else if (error as NSError).code == NSURLErrorCancelled { message = "操作已暂停或取消" }
        else if error is DecodingError { message = "数据格式损坏或版本不兼容，未覆盖原数据" }
        else { message = "文件或网络操作失败，请检查网络、服务器权限及可用空间后重试" }
        // Never return URLSession's URL/headers or encrypted-backup internals.
        reject("LX_LIBRARY", message, nil)
      }
    }
  }
}
