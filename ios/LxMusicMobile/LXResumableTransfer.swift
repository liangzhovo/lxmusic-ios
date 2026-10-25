import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

enum LXTransferError: Error, LocalizedError {
  case response, changed, truncated, tooLarge, unsafeRedirect
  case http(Int)
  var errorDescription: String? {
    switch self {
    case .response: return "下载响应不完整或范围格式不正确"
    case .changed: return "服务器文件或校验标识已变化，请重试并刷新目录"
    case .truncated: return "下载未完整接收，已保留可验证的断点"
    case .tooLarge: return "文件超过大小限制或可用空间不足"
    case .unsafeRedirect: return "下载重定向不安全；WebDAV 请使用最终根地址"
    case .http(let code): return "下载 HTTP \(code)"
    }
  }
}
struct LXResumeCheckpoint: Codable {
  var schema = 1
  var fingerprint: String
  var etag: String
  var total: Int64
  var verifiedSize: Int64
  var verifiedSHA256: String
}
struct LXTransferResult {
  let file: URL
  let bytes: Int64
  let resumedFrom: Int64
  let etag: String?
}

/// HTTP GET resume requires all three: the same source fingerprint, a strong
/// server ETag, and a SHA-256 verified local prefix. An uncheckpointed crash tail
/// is truncated, never blindly appended. Metadata contains no URL or headers.
// Delegate state is confined to one serial OperationQueue.
final class LXResumableTransfer: NSObject, URLSessionDataDelegate, URLSessionTaskDelegate, @unchecked Sendable {
  private let original: URLRequest
  private let file: URL
  private let sidecar: URL
  private let fingerprint: String
  private let maximum: Int64
  private let sizeHint: Int64?
  private let cancellation: LXDAVCancellation
  private let publicRedirects: Bool
  private let digest: (URL) throws -> String
  private let progress: ((Int64, Int64) -> Void)?
  private var checkpoint: LXResumeCheckpoint?
  private var offset: Int64 = 0
  private var count: Int64 = 0
  private var total: Int64 = -1
  private var responseBytes: Int64 = -1
  private var bodyCount: Int64 = 0
  private var etag: String?
  private var receivedResponse = false
  private var invalidPrefix = false
  private var failure: Error?
  private var output: FileHandle?
  private var continuation: CheckedContinuation<LXTransferResult, Error>?
  private var session: URLSession?
  private var redirects = 0
  private var lastProgress: TimeInterval = 0
  private let fm = FileManager.default

  init(request: URLRequest, file: URL, fingerprint: String, maximum: Int64,
       expectedSize: Int64? = nil, cancellation: LXDAVCancellation,
       publicRedirects: Bool = false, digest: @escaping (URL) throws -> String,
       progress: ((Int64, Int64) -> Void)? = nil) {
    self.original = request; self.file = file; sidecar = file.appendingPathExtension("resume.json")
    self.fingerprint = fingerprint; self.maximum = maximum; sizeHint = expectedSize
    self.cancellation = cancellation; self.publicRedirects = publicRedirects
    self.digest = digest; self.progress = progress
  }
  private static func strong(_ value: String?) -> String? {
    guard let value = value, value.utf8.count <= 1024, value.hasPrefix("\""), value.hasSuffix("\""),
      !value.contains("\r"), !value.contains("\n") else { return nil }
    return value
  }
  private func reset() throws {
    if fm.fileExists(atPath: sidecar.path) { try fm.removeItem(at: sidecar) }
    if fm.fileExists(atPath: file.path) { try fm.removeItem(at: file) }
    checkpoint = nil; offset = 0; count = 0
  }
  private func prepare() throws -> URLRequest {
    try cancellation.check()
    guard maximum > 0, maximum <= 64 * 1024 * 1024 * 1024,
      sizeHint.map({ $0 >= 0 && $0 <= maximum }) ?? true,
      let url = original.url, ["http", "https"].contains(url.scheme?.lowercased() ?? ""),
      url.user == nil, url.password == nil, url.fragment == nil else { throw LXTransferError.response }
    try fm.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
    if let data = try? Data(contentsOf: sidecar), data.count < 8192,
      let saved = try? JSONDecoder().decode(LXResumeCheckpoint.self, from: data),
      saved.schema == 1, saved.fingerprint == fingerprint, Self.strong(saved.etag) != nil,
      saved.total > 0, saved.total <= maximum, saved.verifiedSize > 0, saved.verifiedSize < saved.total,
      sizeHint.map({ $0 == saved.total }) ?? true,
      let attrs = try? fm.attributesOfItem(atPath: file.path), attrs[.type] as? FileAttributeType == .typeRegular,
      let bytes = attrs[.size] as? NSNumber, bytes.int64Value >= saved.verifiedSize {
      // The previous checkpoint is durable; bytes received after it aren't.
      let handle = try FileHandle(forWritingTo: file)
      try handle.truncate(atOffset: UInt64(saved.verifiedSize)); try handle.close()
      if try digest(file) == saved.verifiedSHA256 {
        checkpoint = saved; offset = saved.verifiedSize; count = offset
      } else { try reset() }
    } else { try reset() }
    var request = original
    request.httpMethod = "GET"; request.cachePolicy = .reloadIgnoringLocalCacheData
    request.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
    if let saved = checkpoint {
      request.setValue("bytes=\(offset)-", forHTTPHeaderField: "Range")
      request.setValue(saved.etag, forHTTPHeaderField: "If-Range")
    } else {
      request.setValue(nil, forHTTPHeaderField: "Range")
      request.setValue(nil, forHTTPHeaderField: "If-Range")
    }
    return request
  }
  func start() async throws -> LXTransferResult {
    let request = try prepare()
    return try await withCheckedThrowingContinuation { cont in
      continuation = cont
      let configuration = URLSessionConfiguration.ephemeral
      configuration.urlCache = nil; configuration.httpCookieStorage = nil; configuration.urlCredentialStorage = nil
      configuration.httpShouldSetCookies = false; configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
      configuration.timeoutIntervalForRequest = 45; configuration.timeoutIntervalForResource = 3600
      let queue = OperationQueue(); queue.maxConcurrentOperationCount = 1
      let session = URLSession(configuration: configuration, delegate: self, delegateQueue: queue)
      self.session = session
      let task = session.dataTask(with: request); cancellation.attach(task); task.resume()
    }
  }
  private func reject(_ error: Error, task: URLSessionTask) {
    if failure == nil { failure = error }; task.cancel()
  }
  func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                  newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
    guard publicRedirects, redirects < 5, let from = response.url, let to = request.url,
      ["http", "https"].contains(to.scheme?.lowercased() ?? ""), to.user == nil, to.password == nil,
      !(from.scheme == "https" && to.scheme != "https") else {
      failure = LXTransferError.unsafeRedirect; completionHandler(nil); return
    }
    redirects += 1
    var clean = request
    clean.setValue(nil, forHTTPHeaderField: "Authorization"); clean.setValue(nil, forHTTPHeaderField: "Cookie")
    clean.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
    completionHandler(clean)
  }
  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                  completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
    do {
      if let failure = failure { throw failure }
      try cancellation.check()
      guard let response = response as? HTTPURLResponse else { throw LXTransferError.response }
      var headers: [String: String] = [:]
      for (key, value) in response.allHeaderFields { headers[String(describing: key).lowercased()] = String(describing: value) }
      guard headers["content-encoding"].map({ $0.lowercased() == "identity" }) ?? true else { throw LXTransferError.response }
      let length = headers["content-length"].flatMap(Int64.init)
      etag = Self.strong(headers["etag"])
      if response.statusCode == 206 {
        guard let saved = checkpoint, offset > 0, etag == saved.etag,
          let range = headers["content-range"],
          let match = range.range(of: "^bytes [0-9]+-[0-9]+/[0-9]+$", options: .regularExpression), match == range.startIndex..<range.endIndex else {
          invalidPrefix = true; throw LXTransferError.changed
        }
        let values = range.dropFirst(6).split(whereSeparator: { $0 == "-" || $0 == "/" }).compactMap { Int64($0) }
        guard values.count == 3, values[0] == offset, values[1] >= offset,
          values[2] == saved.total, values[1] < values[2],
          length.map({ $0 == values[1] - values[0] + 1 }) ?? true else {
          invalidPrefix = true; throw LXTransferError.changed
        }
        total = values[2]; responseBytes = values[1] - values[0] + 1
      } else if response.statusCode == 200 {
        // A valid server may ignore Range or invalidate If-Range. Start over.
        offset = 0; count = 0; checkpoint = nil
        total = length ?? sizeHint ?? -1; responseBytes = length ?? -1
      } else {
        if response.statusCode == 416 { invalidPrefix = true }
        throw LXTransferError.http(response.statusCode)
      }
      guard total <= maximum, responseBytes <= maximum,
        sizeHint.map({ total < 0 || $0 == total }) ?? true else { throw LXTransferError.changed }
      if !fm.fileExists(atPath: file.path) {
        guard fm.createFile(atPath: file.path, contents: nil, attributes: [.posixPermissions: 0o600]) else { throw LXTransferError.response }
      }
      output = try FileHandle(forWritingTo: file)
      try output?.truncate(atOffset: UInt64(offset)); try output?.seek(toOffset: UInt64(offset))
      receivedResponse = true
      // Persist an empty checkpoint, or the previous verified prefix, before
      // accepting any tail bytes. Abrupt process death never trusts that tail.
      if let etag = etag, total > 0 {
        let prefixHash = try digest(file)
        checkpoint = LXResumeCheckpoint(fingerprint: fingerprint, etag: etag, total: total,
                                        verifiedSize: offset, verifiedSHA256: prefixHash)
        try JSONEncoder().encode(checkpoint!).write(to: sidecar, options: .atomic)
      } else if fm.fileExists(atPath: sidecar.path) { try fm.removeItem(at: sidecar) }
      progress?(count, total)
      completionHandler(.allow)
    } catch {
      failure = error; completionHandler(.cancel)
    }
  }
  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
    guard failure == nil, receivedResponse else { return }
    do {
      try cancellation.check()
      guard Int64(data.count) <= maximum - count,
        total < 0 || Int64(data.count) <= total - count else { throw LXTransferError.tooLarge }
      try output?.write(contentsOf: data)
      count += Int64(data.count); bodyCount += Int64(data.count)
      let now = Date.timeIntervalSinceReferenceDate
      if now - lastProgress >= 0.1 { lastProgress = now; progress?(count, total) }
    } catch { reject(error, task: dataTask) }
  }
  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    var resultError = failure ?? error
    do { try output?.synchronize(); try output?.close() } catch { resultError = resultError ?? error }
    output = nil
    do {
      if invalidPrefix { try reset() }
      else if receivedResponse, let etag = etag, total > 0, count > 0 {
        let saved = LXResumeCheckpoint(fingerprint: fingerprint, etag: etag, total: total,
                                       verifiedSize: count, verifiedSHA256: try digest(file))
        try JSONEncoder().encode(saved).write(to: sidecar, options: .atomic)
      }
      if resultError == nil {
        try cancellation.check()
        guard receivedResponse, count > 0, total < 0 || count == total,
          responseBytes < 0 || bodyCount == responseBytes,
          sizeHint.map({ $0 == count }) ?? true else { throw LXTransferError.truncated }
      }
    } catch { resultError = resultError ?? error }
    let cont = continuation; continuation = nil
    if let error = resultError { cont?.resume(throwing: error) }
    else { progress?(count, count); cont?.resume(returning: LXTransferResult(file: file, bytes: count, resumedFrom: offset, etag: etag)) }
    session.finishTasksAndInvalidate(); self.session = nil
  }
}
