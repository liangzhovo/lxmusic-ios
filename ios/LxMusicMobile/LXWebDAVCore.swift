import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
#if canImport(FoundationXML)
import FoundationXML
#endif

// RFC 4918 subset used by this client. Inputs are decoded, root-relative paths;
// credentials are not accepted in a URI and are never part of a playlist item.
enum LXDALError: Error, LocalizedError {
  case invalidEndpoint, invalidPath, unsafeXML, invalidResponse, tooLarge, cancelled
  case http(Int)
  var errorDescription: String? {
    switch self {
    case .invalidEndpoint: return "WebDAV 地址无效：请填写无用户名、密码或查询参数的 HTTPS 根目录"
    case .invalidPath: return "WebDAV 路径超出配置目录或包含无效字符"
    case .unsafeXML: return "WebDAV 目录响应无效或包含不支持的 XML 声明"
    case .invalidResponse: return "WebDAV 响应或文件长度不完整"
    case .tooLarge: return "WebDAV 数据超过本次操作的安全大小限制"
    case .cancelled: return "操作已取消"
    case .http(let code): return "WebDAV HTTP \(code)"
    }
  }
}

struct LXDAVRoot {
  let url: URL
  let components: [String]
  init(_ endpoint: String, allowHTTP: Bool = false) throws {
    guard endpoint.count <= 4096, !endpoint.contains("\\"),
      let c = URLComponents(string: endpoint), let scheme = c.scheme?.lowercased(),
      (scheme == "https" || (scheme == "http" && allowHTTP)),
      let host = c.host, !host.isEmpty, c.user == nil, c.password == nil,
      c.query == nil, c.fragment == nil, c.port.map({ 1...65535 ~= $0 }) ?? true,
      let candidate = c.url else { throw LXDALError.invalidEndpoint }
    let parts = try Self.decodePath(c.percentEncodedPath)
    var canonical = URLComponents(url: candidate, resolvingAgainstBaseURL: false)!
    canonical.scheme = scheme
    canonical.percentEncodedPath = "/" + parts.map(Self.encode).joined(separator: "/") + (parts.isEmpty ? "" : "/")
    guard let url = canonical.url else { throw LXDALError.invalidEndpoint }
    self.url = url
    self.components = parts
  }
  static func encode(_ value: String) -> String {
    value.addingPercentEncoding(withAllowedCharacters: CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"))!
  }
  static func validSegment(_ value: String) -> Bool {
    !value.isEmpty && value != "." && value != ".." && !value.contains("/") && !value.contains("\\") &&
      value.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) })
  }
  static func pathParts(_ path: String) throws -> [String] {
    guard path.utf8.count <= 16384, !path.hasPrefix("//") else { throw LXDALError.invalidPath }
    let parts = path.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
    var normalized = parts
    if normalized.first == "" { normalized.removeFirst() }
    if normalized.last == "" { normalized.removeLast() }
    guard normalized.allSatisfy(validSegment) else { throw LXDALError.invalidPath }
    return normalized
  }
  static func decodePath(_ encoded: String) throws -> [String] {
    let parts = encoded.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
    var decoded: [String] = []
    for (index, part) in parts.enumerated() {
      if part.isEmpty && (index == 0 || index == parts.count - 1) { continue }
      guard let value = part.removingPercentEncoding, validSegment(value) else { throw LXDALError.invalidPath }
      decoded.append(value)
    }
    return decoded
  }
  func resource(_ path: String, directory: Bool = false) throws -> URL {
    let relative = try Self.pathParts(path)
    var c = URLComponents(url: url, resolvingAgainstBaseURL: false)!
    c.percentEncodedPath = "/" + (components + relative).map(Self.encode).joined(separator: "/")
    if directory && !c.percentEncodedPath.hasSuffix("/") { c.percentEncodedPath += "/" }
    guard let result = c.url else { throw LXDALError.invalidPath }
    return result
  }
  private static func origin(_ url: URL) -> String {
    let scheme = url.scheme?.lowercased() ?? ""
    return "\(scheme)://\(url.host?.lowercased() ?? ""):\(url.port ?? (scheme == "https" ? 443 : 80))"
  }
  // Validate the encoded segments BEFORE URL standardization can erase '..'.
  func relativeHref(_ href: String, requested: String) throws -> String {
    guard !href.contains("\\"), !href.hasPrefix("//"),
      let raw = URLComponents(string: href), raw.user == nil, raw.password == nil,
      raw.query == nil, raw.fragment == nil else { throw LXDALError.invalidPath }
    let hrefParts = try Self.decodePath(raw.percentEncodedPath)
    let resolvedParts: [String]
    if raw.scheme != nil {
      guard let absolute = raw.url, Self.origin(absolute) == Self.origin(url) else { throw LXDALError.invalidPath }
      resolvedParts = hrefParts
    } else if href.hasPrefix("/") { resolvedParts = hrefParts }
    else { resolvedParts = components + (try Self.pathParts(requested)) + hrefParts }
    guard resolvedParts.starts(with: components) else { throw LXDALError.invalidPath }
    return resolvedParts.dropFirst(components.count).joined(separator: "/")
  }
}

struct LXDAVEntry: Codable, Equatable {
  var path: String
  var name: String
  var directory: Bool
  var size: Int64?
  var etag: String?
  var modified: String?
}

private final class LXDAVXML: NSObject, XMLParserDelegate {
  private struct Node { var namespace: String; var name: String; var text = "" }
  private var stack: [Node] = []
  private var href = ""
  private var properties: [String: String] = [:]
  private var goodProperties: [String: String] = [:]
  private var propStatus = ""
  private var responseStatus = ""
  private var inProperty = false
  private var recordCount = 0
  private var sawRoot = false
  private var failure: Error?
  var records: [(String, [String: String])] = []
  func parser(_ parser: XMLParser, didStartElement name: String, namespaceURI: String?, qualifiedName: String?, attributes: [String: String] = [:]) {
    stack.append(Node(namespace: namespaceURI ?? "", name: name))
    if stack.count > 32 { failure = LXDALError.unsafeXML; parser.abortParsing(); return }
    if stack.count == 1 {
      guard name == "multistatus", namespaceURI == "DAV:" else { failure = LXDALError.unsafeXML; parser.abortParsing(); return }
      sawRoot = true
    }
    guard namespaceURI == "DAV:" else { return }
    if name == "response" && stack.count == 2 {
      href = ""; goodProperties = [:]; responseStatus = ""; recordCount += 1
      if recordCount > 10000 { failure = LXDALError.tooLarge; parser.abortParsing() }
    } else if name == "propstat" && stack.count == 3 {
      properties = [:]; propStatus = ""
    } else if name == "prop" && stack.count == 4 { inProperty = true }
    else if name == "collection" && inProperty && stack.count == 6 && stack[4].name == "resourcetype" && stack[4].namespace == "DAV:" {
      properties["collection"] = "true"
    }
  }
  func parser(_ parser: XMLParser, foundCharacters string: String) {
    guard !stack.isEmpty else { return }
    stack[stack.count - 1].text += string
    if stack[stack.count - 1].text.utf8.count > 65536 { failure = LXDALError.tooLarge; parser.abortParsing() }
  }
  func parser(_ parser: XMLParser, foundCDATA CDATABlock: Data) {
    guard let text = String(data: CDATABlock, encoding: .utf8) else { failure = LXDALError.unsafeXML; parser.abortParsing(); return }
    self.parser(parser, foundCharacters: text)
  }
  func parser(_ parser: XMLParser, didEndElement name: String, namespaceURI: String?, qualifiedName: String?) {
    guard let node = stack.last else { failure = LXDALError.unsafeXML; return }
    defer { stack.removeLast() }
    guard namespaceURI == "DAV:" else { return }
    let text = node.text.trimmingCharacters(in: .whitespacesAndNewlines)
    if name == "href" && stack.count == 3 { href = text }
    else if name == "status" && stack.count == 3 { responseStatus = text }
    else if name == "status" && stack.count == 4 { propStatus = text }
    else if inProperty && stack.count == 5 && ["getcontentlength", "getetag", "getlastmodified", "resourcetype"].contains(name) {
      properties[name] = text
    } else if name == "prop" && stack.count == 4 { inProperty = false }
    else if name == "propstat" && stack.count == 3 {
      if Self.status(propStatus) == 200 { goodProperties.merge(properties, uniquingKeysWith: { _, new in new }) }
    } else if name == "response" && stack.count == 2 {
      if !href.isEmpty && (responseStatus.isEmpty || Self.status(responseStatus).map({ 200...299 ~= $0 }) == true) && !goodProperties.isEmpty {
        records.append((href, goodProperties))
      }
    }
  }
  private static func status(_ value: String) -> Int? {
    let parts = value.split(separator: " ")
    guard parts.count >= 2, parts[0].hasPrefix("HTTP/") else { return nil }
    return Int(parts[1])
  }
  func parser(_ parser: XMLParser, resolveExternalEntityName name: String, systemID: String?) -> Data? {
    failure = LXDALError.unsafeXML; parser.abortParsing(); return nil
  }
  func parser(_ parser: XMLParser, parseErrorOccurred error: Error) { failure = failure ?? error }
  static func read(_ data: Data, root: LXDAVRoot, requested: String) throws -> [LXDAVEntry] {
    guard data.count <= 8 * 1024 * 1024 else { throw LXDALError.tooLarge }
    // Reject DTD/entities even if the OS XML implementation would ignore them.
    guard let text = String(data: data, encoding: .utf8), !text.uppercased().contains("<!DOCTYPE"), !text.uppercased().contains("<!ENTITY") else { throw LXDALError.unsafeXML }
    let delegate = LXDAVXML()
    let parser = XMLParser(data: data)
    parser.shouldProcessNamespaces = true
    parser.shouldResolveExternalEntities = false
    parser.delegate = delegate
    guard parser.parse(), delegate.failure == nil, delegate.sawRoot else { throw delegate.failure ?? LXDALError.unsafeXML }
    let parent = try LXDAVRoot.pathParts(requested)
    var seen = Set<String>()
    var entries: [LXDAVEntry] = []
    for (href, props) in delegate.records {
      let path = try root.relativeHref(href, requested: requested)
      let parts = try LXDAVRoot.pathParts(path)
      if parts == parent { continue }
      // A Depth: 1 response must not smuggle another collection or ancestor.
      guard parts.count == parent.count + 1, parts.starts(with: parent) else { throw LXDALError.invalidPath }
      guard seen.insert(path).inserted else { continue }
      let size = props["getcontentlength"].flatMap(Int64.init)
      if let size = size, size < 0 { throw LXDALError.invalidResponse }
      entries.append(LXDAVEntry(path: path, name: parts.last!, directory: props["collection"] == "true",
        size: size, etag: props["getetag"], modified: props["getlastmodified"]))
    }
    return entries.sorted { a, b in
      if a.directory != b.directory { return a.directory }
      return a.name.localizedStandardCompare(b.name) == .orderedAscending
    }
  }
}

final class LXDAVCancellation: @unchecked Sendable {
  private let lock = NSLock()
  private var task: URLSessionTask?
  private var cancelled = false
  func attach(_ task: URLSessionTask) {
    lock.lock(); self.task = task; let cancel = cancelled; lock.unlock()
    if cancel { task.cancel() }
  }
  func cancel() { lock.lock(); cancelled = true; let task = task; lock.unlock(); task?.cancel() }
  func check() throws { lock.lock(); let cancelled = cancelled; lock.unlock(); if cancelled { throw LXDALError.cancelled } }
}

struct LXDAVHTTPResponse {
  let status: Int
  let headers: [String: String]
  let body: Data
  let file: URL?
}

// One session/job: no shared cookie jar, credential store, URL cache or secrets
// on redirects. Streaming transfers use a file, not a base64 JS buffer.
final class LXDAVHTTPJob: NSObject, URLSessionDataDelegate, URLSessionDownloadDelegate, @unchecked Sendable {
  private let request: URLRequest
  private let source: URL?
  private let destination: URL?
  private let limit: Int64
  private let cancellation: LXDAVCancellation
  private let progress: ((Int64, Int64) -> Void)?
  private let publicRedirects: Bool
  private var redirectCount = 0
  private var response: HTTPURLResponse?
  private var data = Data()
  private var failure: Error?
  private var savedFile: URL?
  private var continuation: CheckedContinuation<LXDAVHTTPResponse, Error>?
  private var session: URLSession?
  init(request: URLRequest, source: URL? = nil, destination: URL? = nil, maxBytes: Int64,
       cancellation: LXDAVCancellation, publicRedirects: Bool = false, progress: ((Int64, Int64) -> Void)? = nil) {
    self.request = request; self.source = source; self.destination = destination
    self.limit = maxBytes; self.cancellation = cancellation; self.publicRedirects = publicRedirects; self.progress = progress
  }
  func start() async throws -> LXDAVHTTPResponse {
    try cancellation.check()
    return try await withCheckedThrowingContinuation { continuation in
      self.continuation = continuation
      let config = URLSessionConfiguration.ephemeral
      config.urlCache = nil; config.httpCookieStorage = nil; config.urlCredentialStorage = nil
      config.httpShouldSetCookies = false
      config.requestCachePolicy = .reloadIgnoringLocalCacheData
      config.timeoutIntervalForRequest = 45
      config.timeoutIntervalForResource = 3600
      let session = URLSession(configuration: config, delegate: self, delegateQueue: nil)
      self.session = session
      let task: URLSessionTask
      if let source = source { task = session.uploadTask(with: request, fromFile: source) }
      else if destination != nil { task = session.downloadTask(with: request) }
      else { task = session.dataTask(with: request) }
      cancellation.attach(task)
      task.resume()
    }
  }
  func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                  newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
    // DAV operations intentionally require the canonical endpoint entered by the
    // user. Public music transfers may redirect, but never carry DAV credentials.
    guard publicRedirects, redirectCount < 5, let url = request.url, ["https", "http"].contains(url.scheme?.lowercased() ?? ""),
      url.user == nil, url.password == nil,
      !(response.url?.scheme?.lowercased() == "https" && url.scheme?.lowercased() == "http") else { completionHandler(nil); return }
    redirectCount += 1
    var next = request
    next.setValue(nil, forHTTPHeaderField: "Authorization")
    next.setValue(nil, forHTTPHeaderField: "Cookie")
    completionHandler(next)
  }
  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                  completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
    self.response = response as? HTTPURLResponse
    if request.httpMethod != "HEAD" && response.expectedContentLength > limit { failure = LXDALError.tooLarge; completionHandler(.cancel) }
    else { completionHandler(.allow) }
  }
  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
    if Int64(self.data.count) + Int64(data.count) > limit { failure = LXDALError.tooLarge; dataTask.cancel(); return }
    self.data.append(data)
  }
  func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64,
                  totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
    if totalBytesWritten > limit || totalBytesExpectedToWrite > limit { failure = LXDALError.tooLarge; downloadTask.cancel() }
    progress?(totalBytesWritten, totalBytesExpectedToWrite)
  }
  func urlSession(_ session: URLSession, task: URLSessionTask, didSendBodyData bytesSent: Int64,
                  totalBytesSent: Int64, totalBytesExpectedToSend: Int64) { progress?(totalBytesSent, totalBytesExpectedToSend) }
  func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
    self.response = downloadTask.response as? HTTPURLResponse
    guard failure == nil, let destination = destination, let response = self.response, response.statusCode == 200 else { return }
    do {
      try cancellation.check()
      let size = try FileManager.default.attributesOfItem(atPath: location.path)[.size] as? NSNumber
      guard let size = size?.int64Value, size <= limit else { throw LXDALError.tooLarge }
      let expected = response.expectedContentLength
      guard expected < 0 || expected == size else { throw LXDALError.invalidResponse }
      // Never overwrite an existing destination. All caller paths are unique,
      // app-owned staging files; publication is a separate checked operation.
      try FileManager.default.moveItem(at: location, to: destination)
      savedFile = destination
    } catch { failure = error }
  }
  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    defer { session.finishTasksAndInvalidate(); self.session = nil }
    let completion = continuation; continuation = nil
    do {
      try cancellation.check()
      if let error = failure ?? error { throw error }
      guard let response = response ?? task.response as? HTTPURLResponse else { throw LXDALError.invalidResponse }
      let headers = response.allHeaderFields.reduce(into: [String: String]()) { result, item in result[String(describing: item.key).lowercased()] = String(describing: item.value) }
      completion?.resume(returning: LXDAVHTTPResponse(status: response.statusCode, headers: headers, body: data, file: savedFile))
    } catch {
      if let file = savedFile { try? FileManager.default.removeItem(at: file) }
      completion?.resume(throwing: error)
    }
  }
}

final class LXDAVClient {
  let root: LXDAVRoot
  private let authorization: String
  init(root: LXDAVRoot, username: String, password: String) throws {
    guard !username.contains(":"), username.utf8.count <= 8192, password.utf8.count <= 65536 else { throw LXDALError.invalidEndpoint }
    self.root = root
    self.authorization = "Basic " + Data((username + ":" + password).utf8).base64EncodedString()
  }
  func request(_ method: String, path: String, directory: Bool = false, headers: [String: String] = [:], body: Data? = nil) throws -> URLRequest {
    var request = URLRequest(url: try root.resource(path, directory: directory))
    request.httpMethod = method
    request.setValue(authorization, forHTTPHeaderField: "Authorization")
    request.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
    request.setValue("LX-Music-iOS-WebDAV/1", forHTTPHeaderField: "User-Agent")
    request.httpBody = body
    for (name, value) in headers { request.setValue(value, forHTTPHeaderField: name) }
    return request
  }
  func list(_ path: String, cancellation: LXDAVCancellation = LXDAVCancellation()) async throws -> [LXDAVEntry] {
    let xml = "<?xml version=\"1.0\" encoding=\"utf-8\"?><d:propfind xmlns:d=\"DAV:\"><d:prop><d:resourcetype/><d:getcontentlength/><d:getetag/><d:getlastmodified/></d:prop></d:propfind>"
    let req = try request("PROPFIND", path: path, directory: true, headers: ["Depth": "1", "Content-Type": "application/xml; charset=utf-8"], body: Data(xml.utf8))
    let response = try await LXDAVHTTPJob(request: req, maxBytes: 8 * 1024 * 1024, cancellation: cancellation).start()
    guard response.status == 207 else { throw LXDALError.http(response.status) }
    return try Self.parseListing(response.body, root: root, requested: path)
  }
  static func parseListing(_ data: Data, root: LXDAVRoot, requested: String) throws -> [LXDAVEntry] {
    try LXDAVXML.read(data, root: root, requested: requested)
  }
  func download(_ path: String, to destination: URL, maxBytes: Int64,
                cancellation: LXDAVCancellation = LXDAVCancellation(), progress: ((Int64, Int64) -> Void)? = nil) async throws -> URL {
    let req = try request("GET", path: path)
    let response = try await LXDAVHTTPJob(request: req, destination: destination, maxBytes: maxBytes, cancellation: cancellation, progress: progress).start()
    guard response.status == 200 else { throw LXDALError.http(response.status) }
    guard let file = response.file else { throw LXDALError.invalidResponse }
    return file
  }
  func stat(_ path: String, cancellation: LXDAVCancellation = LXDAVCancellation()) async throws -> [String: String] {
    let response = try await LXDAVHTTPJob(request: request("HEAD", path: path), maxBytes: 65536, cancellation: cancellation).start()
    guard response.status == 200 else { throw LXDALError.http(response.status) }
    return response.headers
  }
  // PUT a unique staging name, verify the remote byte count, then MOVE with
  // Overwrite:F. A destination conflict never deletes/replaces the user's file.
  func upload(_ local: URL, to path: String, cancellation: LXDAVCancellation = LXDAVCancellation(),
              progress: ((Int64, Int64) -> Void)? = nil) async throws {
    let parts = try LXDAVRoot.pathParts(path)
    guard !parts.isEmpty else { throw LXDALError.invalidPath }
    let size = (try FileManager.default.attributesOfItem(atPath: local.path)[.size] as? NSNumber)?.int64Value
    guard let size = size, size >= 0 else { throw LXDALError.invalidResponse }
    let temp = (Array(parts.dropLast()) + [".lx-upload-" + UUID().uuidString.lowercased() + ".part"]).joined(separator: "/")
    var putAttempted = false
    do {
      try cancellation.check()
      let put = try request("PUT", path: temp, headers: ["If-None-Match": "*", "Content-Type": "application/octet-stream", "Content-Length": String(size)])
      let result = try await LXDAVHTTPJob(request: put, source: local, maxBytes: 65536, cancellation: cancellation, progress: progress).start()
      guard [200, 201, 204].contains(result.status) else { throw LXDALError.http(result.status) }
      putAttempted = true
      let remote = try await stat(temp, cancellation: cancellation)
      guard remote["content-length"].flatMap(Int64.init) == size else { throw LXDALError.invalidResponse }
      let move = try request("MOVE", path: temp, headers: ["Destination": try root.resource(path).absoluteString, "Overwrite": "F"])
      let moved = try await LXDAVHTTPJob(request: move, maxBytes: 65536, cancellation: cancellation).start()
      guard [201, 204].contains(moved.status) else { throw LXDALError.http(moved.status) }
      putAttempted = false
    } catch {
      if putAttempted {
        // Only our random, newly-created staging name is eligible for cleanup.
        _ = try? await LXDAVHTTPJob(request: request("DELETE", path: temp), maxBytes: 65536, cancellation: LXDAVCancellation()).start()
      }
      throw error
    }
  }
}
