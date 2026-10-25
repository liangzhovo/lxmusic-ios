import Foundation
import CryptoKit

/// All durable library mutations enter this actor. Network operations may yield,
/// so account revisions and the exclusive backup gate are checked after awaits.
actor LXLibraryWorker {
  typealias Progress = (String, Int64, Int64) -> Void
  let paths: LXLibraryPaths
  let restore: LXRestoreCoordinator
  let registry: LXOperationRegistry
  private var exclusive = false
  private var activeTransfers = Set<String>()
  private var liveLeases = Set<String>()
  private let audioMaximum: Int64 = 2 * 1024 * 1024 * 1024
  init(restore: LXRestoreCoordinator, registry: LXOperationRegistry) throws {
    self.paths = restore.paths; self.restore = restore; self.registry = registry
    try paths.initialize()
    // These are ephemeral playback copies only. Never clean user downloads here.
    for f in try LXFiles.fm.contentsOfDirectory(at: paths.leases, includingPropertiesForKeys: nil) {
      try LXFiles.removeOwned(f, below: paths.leases)
    }
  }
  private func config() throws -> LXLibraryConfig {
    if !LXFiles.fm.fileExists(atPath: paths.config.path) { return LXLibraryConfig() }
    let c = try LXFiles.read(LXLibraryConfig.self, from: paths.config)
    guard c.schema == 1, c.accounts.count <= 1000, (0...32768).contains(c.audioLimitMB), Set(c.accounts.map { $0.id }).count == c.accounts.count else {
      throw LXLibraryError("资料库配置损坏或版本不兼容，未覆盖原数据")
    }
    return c
  }
  private func account(_ id: String) throws -> LXLibraryAccount {
    guard let a = try config().accounts.first(where: { $0.id == id }) else { throw LXLibraryError("WebDAV账户不存在，请检查账户配置") }
    return a
  }
  private func client(_ a: LXLibraryAccount) throws -> LXDAVClient {
    guard let secret = try restore.vault.read(a.secretRef), let password = String(data: secret, encoding: .utf8) else { throw LXLibraryError("WebDAV密码不可用，请解锁设备或重新填写密码") }
    return try LXDAVClient(root: LXDAVRoot(a.endpoint, allowHTTP: a.allowHTTP), username: a.username, password: password)
  }
  private func unchanged(_ a: LXLibraryAccount) throws {
    guard try account(a.id).revision == a.revision else { throw LXLibraryError("WebDAV配置已改变，请重新操作") }
  }
  private func publicConfig() throws -> Any {
    var result = try LXFiles.object(config()) as! [String: Any]
    result["accounts"] = try config().accounts.map { a -> [String: Any] in
      var values = try LXFiles.object(a) as! [String: Any]
      values.removeValue(forKey: "secretRef"); values["passwordSaved"] = true
      return values
    }
    return result
  }
  private func text(_ p: [String: Any], _ key: String, fallback: String = "") -> String { p[key] as? String ?? fallback }
  private func token(_ p: [String: Any]) throws -> (String, LXDAVCancellation) {
    let id = text(p, "operationId"); return (id, try registry.begin(id))
  }
  private func beginMutation() throws { if exclusive { throw LXLibraryError("正在备份或准备恢复，请等待当前操作结束") } }
  private func cacheKey(_ a: LXLibraryAccount, path: String, tag: String = "") -> String {
    LXFiles.hash(Data(([a.id, a.revision, path, tag].joined(separator: "\u{0}")).utf8))
  }
  private func file(_ folder: String, _ name: String) throws -> URL { try LXFiles.child(paths.folder(folder), name) }
  private func removeIfExists(_ url: URL, below: URL) throws { try LXFiles.removeOwned(url, below: below) }
  private func trimDirectoryCache() throws {
    let folder = try paths.folder("directory-cache")
    let files = try LXFiles.fm.contentsOfDirectory(at: folder, includingPropertiesForKeys: [.contentModificationDateKey, .fileSizeKey])
      .sorted { ((try? $0.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast) < ((try? $1.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast) }
    var bytes = files.reduce(Int64(0)) { $0 + ((try? LXFiles.size($1)) ?? 0) }; var count = files.count
    for f in files where bytes > 20 * 1024 * 1024 || count > 100 {
      bytes -= (try? LXFiles.size(f)) ?? 0; count -= 1; try removeIfExists(f, below: folder)
    }
  }
  private func directory(_ a: LXLibraryAccount, path: String, force: Bool, cancellation: LXDAVCancellation) async throws -> [LXDAVEntry] {
    _ = try LXDAVRoot.pathParts(path)
    let f = try file("directory-cache", cacheKey(a, path: path) + ".json")
    if a.directoryCache && !force, let saved = try? LXFiles.read(LXDirectoryCacheRecord.self, from: f, max: 8 * 1024 * 1024),
       Date().timeIntervalSince1970 - saved.created < 300, saved.created <= Date().timeIntervalSince1970 + 5 { return saved.entries }
    let entries = try await client(a).list(path, cancellation: cancellation)
    try cancellation.check(); try unchanged(a)
    if try account(a.id).directoryCache {
      try LXFiles.write(LXDirectoryCacheRecord(created: Date().timeIntervalSince1970, entries: entries), to: f)
      try trimDirectoryCache()
    }
    return entries
  }
  private func createLease(_ source: URL) throws -> (URL, String) {
    let id = UUID().uuidString.lowercased() + "." + source.pathExtension
    let target = try LXFiles.child(paths.leases, id)
    do { try LXFiles.fm.linkItem(at: source, to: target) }
    catch { try LXFiles.fm.copyItem(at: source, to: target) }
    liveLeases.insert(id); return (target, id)
  }
  private func trimAudioCache() throws {
    let folder = try paths.folder("audio-cache"), maximum = Int64(try config().audioLimitMB) * 1024 * 1024
    var records: [(URL, LXAudioCacheRecord)] = []
    for f in try LXFiles.fm.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil) where f.pathExtension == "json" {
      if let r = try? LXFiles.read(LXAudioCacheRecord.self, from: f), let audio = try? LXFiles.child(folder, r.file), LXFiles.fm.fileExists(atPath: audio.path) { records.append((f, r)) }
      else { try removeIfExists(f, below: folder) }
    }
    var used = records.reduce(Int64(0)) { $0 + $1.1.size }
    for (f, record) in records.sorted(by: { $0.1.accessed < $1.1.accessed }) where used > maximum {
      let audio = try LXFiles.child(folder, record.file)
      try removeIfExists(audio, below: folder); try removeIfExists(f, below: folder); used -= record.size
    }
    // Remove only unreferenced cache files; hard-linked active playback leases survive.
    let referenced = Set(try LXFiles.fm.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil).filter { $0.pathExtension == "json" }
      .compactMap { try? LXFiles.read(LXAudioCacheRecord.self, from: $0).file })
    for f in try LXFiles.fm.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil) where f.pathExtension != "json" && !referenced.contains(f.lastPathComponent) {
      try removeIfExists(f, below: folder)
    }
  }
  private func playback(_ ref: LXLibraryReference, cancellation: LXDAVCancellation, progress: @escaping Progress) async throws -> Any {
    try beginMutation()
    if ref.kind == "local" {
      let source = try LXFiles.child(paths.downloads, ref.path)
      _ = try LXFiles.audioExtension(source, hint: source.pathExtension)
      if let hash = ref.sha256, let size = ref.size, !LXFiles.verified(source, size: size, hash: hash) { throw LXLibraryError("本地音频校验失败，请重新下载") }
      let (url, lease) = try createLease(source)
      return ["url": url.absoluteString, "lease": lease, "cached": true]
    }
    guard ref.kind == "webdav", let id = ref.accountId else { throw LXLibraryError("音乐文件引用无效") }
    let a = try account(id), key = cacheKey(a, path: ref.path, tag: (ref.etag ?? "") + "/" + String(ref.size ?? -1))
    let folder = try paths.folder("audio-cache"), recordFile = try LXFiles.child(folder, key + ".json")
    if a.audioCache, try config().audioLimitMB > 0, var r = try? LXFiles.read(LXAudioCacheRecord.self, from: recordFile),
       let audio = try? LXFiles.child(folder, r.file), LXFiles.verified(audio, size: r.size, hash: r.sha256) {
      r.accessed = Date().timeIntervalSince1970; try LXFiles.write(r, to: recordFile)
      let (url, lease) = try createLease(audio); return ["url": url.absoluteString, "lease": lease, "cached": true]
    }
    let temp = try file("transfers", "play-" + UUID().uuidString + ".part")
    defer { try? removeIfExists(temp, below: paths.library); try? removeIfExists(temp.appendingPathExtension("resume.json"), below: paths.library) }
    let request = try client(a).request("GET", path: ref.path)
    let response = try await LXResumableTransfer(request: request, file: temp, fingerprint: cacheKey(a, path: ref.path), maximum: audioMaximum,
      expectedSize: ref.sha256 == nil ? nil : ref.size, cancellation: cancellation, digest: LXFiles.hash, progress: { progress("preparing", $0, $1) }).start()
    try cancellation.check(); try unchanged(a)
    let ext = try LXFiles.audioExtension(temp, hint: URL(fileURLWithPath: ref.path).pathExtension), hash = try LXFiles.hash(temp)
    if let expectedHash = ref.sha256, expectedHash != hash { throw LXLibraryError("WebDAV文件内容已变化，校验失败") }
    let latest = try account(a.id), maximum = Int64(try config().audioLimitMB) * 1024 * 1024
    if latest.audioCache && maximum >= response.bytes {
      let target = try LXFiles.child(folder, key + "." + ext)
      if LXFiles.fm.fileExists(atPath: target.path) { try removeIfExists(target, below: folder) }
      try LXFiles.fm.moveItem(at: temp, to: target)
      try LXFiles.write(LXAudioCacheRecord(file: target.lastPathComponent, size: response.bytes, sha256: hash, accessed: Date().timeIntervalSince1970, accountId: a.id), to: recordFile)
      let (url, lease) = try createLease(target); try trimAudioCache()
      return ["url": url.absoluteString, "lease": lease, "cached": false]
    }
    let named = temp.deletingPathExtension().appendingPathExtension(ext)
    try LXFiles.fm.moveItem(at: temp, to: named); defer { try? removeIfExists(named, below: paths.library) }
    let (url, lease) = try createLease(named); return ["url": url.absoluteString, "lease": lease, "cached": false]
  }
  private func ensureDirectory(_ client: LXDAVClient, _ path: String, cancellation: LXDAVCancellation) async throws {
    let parts = try LXDAVRoot.pathParts(path)
    for i in parts.indices {
      let current = parts.prefix(i + 1).joined(separator: "/")
      let response = try await LXDAVHTTPJob(request: client.request("MKCOL", path: current, directory: true), source: nil, destination: nil,
        maxBytes: 1024 * 1024, cancellation: cancellation).start()
      guard response.status == 201 || response.status == 405 else { throw LXDALError.http(response.status) }
      // A 405 alone does not prove this is a directory. Depth-one discovery does.
      if response.status == 405 { _ = try await client.list(current, cancellation: cancellation) }
    }
  }
  private func remoteVerified(_ c: LXDAVClient, path: String, size: Int64, hash: String, cancellation: LXDAVCancellation, progress: @escaping Progress) async throws -> Bool {
    let temp = try file("transfers", "verify-" + UUID().uuidString + ".part")
    defer { try? removeIfExists(temp, below: paths.library) }
    do {
      let headers = try await c.stat(path, cancellation: cancellation)
      if let value = headers["content-length"], Int64(value) != size { return false }
      try await c.download(path, to: temp, maxBytes: max(1, size), cancellation: cancellation, progress: { progress("verifying", $0, $1) })
      return LXFiles.verified(temp, size: size, hash: hash)
    } catch LXDALError.http(404) { return false }
  }
  /// WebDAV does not define portable partial PUT. Stage+readback+MOVE protects
  /// final files; retry reuses the verified local download and retries upload.
  private func publishDAV(_ source: URL, a: LXLibraryAccount, folder: String, name: String, size: Int64, hash: String,
                          cancellation: LXDAVCancellation, progress: @escaping Progress) async throws -> String {
    let c = try client(a), parts = try LXDAVRoot.pathParts(folder), final = (parts + [name]).joined(separator: "/")
    try await ensureDirectory(c, folder, cancellation: cancellation)
    if try await remoteVerified(c, path: final, size: size, hash: hash, cancellation: cancellation, progress: progress) { return final }
    do {
      _ = try await c.stat(final, cancellation: cancellation)
      throw LXLibraryError("目标文件已存在但内容不同，未覆盖服务器文件")
    } catch LXDALError.http(404) { /* reserved final name is free */ }
    let staging = (parts + [".lx-upload-" + UUID().uuidString + ".part"]).joined(separator: "/")
    var owned = false
    do {
      // Claim an empty random staging resource before uploading. Only a
      // successful conditional creation grants cleanup ownership; a 412 never
      // lets us delete somebody else's object. Subsequent interrupted PUTs are
      // cleaned because ownership was already durably established remotely.
      let claim = try await LXDAVHTTPJob(request: c.request("PUT", path: staging, headers: ["If-None-Match": "*", "Content-Length": "0"], body: Data()),
        source: nil, destination: nil, maxBytes: 1024 * 1024, cancellation: cancellation).start()
      guard [200, 201, 204].contains(claim.status) else { throw LXDALError.http(claim.status) }
      owned = true
      let put = try await LXDAVHTTPJob(request: c.request("PUT", path: staging, headers: ["Content-Length": String(size)]),
        source: source, destination: nil, maxBytes: 1024 * 1024, cancellation: cancellation, progress: { progress("uploading", $0, $1) }).start()
      guard [200, 201, 204].contains(put.status) else { throw LXDALError.http(put.status) }; owned = true
      guard try await remoteVerified(c, path: staging, size: size, hash: hash, cancellation: cancellation, progress: progress) else { throw LXLibraryError("服务器上传内容校验失败，未发布目标文件") }
      try cancellation.check(); try unchanged(a)
      let move = try await LXDAVHTTPJob(request: c.request("MOVE", path: staging,
        headers: ["Destination": c.root.resource(final).absoluteString, "Overwrite": "F"]), source: nil, destination: nil,
        maxBytes: 1024 * 1024, cancellation: cancellation).start()
      guard [201, 204].contains(move.status) else { throw LXDALError.http(move.status) }
      owned = false
      return final
    } catch {
      // Use a fresh cancellation token solely to clean OUR random staging name.
      // Never DELETE a final path or overwrite an unrelated remote file.
      if owned {
        _ = try? await LXDAVHTTPJob(request: c.request("DELETE", path: staging), source: nil, destination: nil, maxBytes: 1024 * 1024, cancellation: LXDAVCancellation()).start()
      }
      throw error
    }
  }
  private func download(_ p: [String: Any], cancellation: LXDAVCancellation, progress: @escaping Progress) async throws -> Any {
    try beginMutation()
    let jobId = text(p, "jobId"); try LXFiles.requireID(jobId)
    guard !activeTransfers.contains(jobId) else { throw LXLibraryError("同一任务正在下载") }
    activeTransfers.insert(jobId); defer { activeTransfers.remove(jobId) }
    let receiptFile = try file("receipts", jobId + ".json")
    if let saved = try? LXFiles.read(LXPublishedFile.self, from: receiptFile) {
      if saved.kind == "local", let local = try? LXFiles.child(paths.downloads, saved.path), LXFiles.verified(local, size: saved.size, hash: saved.sha256) { return try LXFiles.object(saved) }
      if saved.kind == "webdav", let id = saved.accountId, let a = try? account(id),
         try await remoteVerified(client(a), path: saved.path, size: saved.size, hash: saved.sha256, cancellation: cancellation, progress: progress) { return try LXFiles.object(saved) }
      throw LXLibraryError("已完成任务的文件已变化，请新建下载任务，原记录未覆盖")
    }
    let source = p["source"] as? [String: Any] ?? [:], target = p["destination"] as? [String: Any] ?? [:]
    let destinationKind = text(target, "kind")
    guard ["local", "webdav"].contains(destinationKind) else { throw LXLibraryError("下载目标无效") }
    let partial = try file("transfers", jobId + ".part"), checked = try file("transfers", jobId + ".verified.json")
    var size: Int64; var hash: String; var ext: String
    let fingerprintData = try JSONSerialization.data(withJSONObject: source, options: [.sortedKeys])
    var fingerprint = LXFiles.hash(fingerprintData)
    if text(source, "kind") == "webdav" {
      let a = try account(text(source, "accountId"))
      fingerprint = cacheKey(a, path: text(source, "path"), tag: fingerprint)
    }
    if let saved = try? LXFiles.read([String: String].self, from: checked), saved["fingerprint"] == fingerprint,
       let n = saved["size"].flatMap(Int64.init), let sha = saved["sha256"], LXFiles.verified(partial, size: n, hash: sha), let format = saved["ext"] {
      size = n; hash = sha; ext = format
    } else {
      if text(source, "kind") == "local" {
        let original = try LXFiles.insideHome(text(source, "path"), paths: paths)
        guard try LXFiles.size(original) <= audioMaximum else { throw LXLibraryError("音频超过单文件大小限制") }
        try removeIfExists(partial, below: paths.library); try LXFiles.fm.copyItem(at: original, to: partial)
      } else {
        let req: URLRequest; var allowRedirects = false; var knownSize: Int64?; var a: LXLibraryAccount?
        if text(source, "kind") == "webdav" {
          let account = try self.account(text(source, "accountId")); a = account
          req = try client(account).request("GET", path: text(source, "path")); knownSize = source["sha256"] == nil ? nil : (source["size"] as? NSNumber)?.int64Value
        } else {
          guard text(source, "kind") == "url", let u = URL(string: text(source, "url")), ["https", "http"].contains(u.scheme?.lowercased() ?? ""),
            u.host != nil, u.user == nil, u.password == nil, u.fragment == nil else { throw LXLibraryError("音源下载地址无效") }
          req = URLRequest(url: u); allowRedirects = true
        }
        _ = try await LXResumableTransfer(request: req, file: partial, fingerprint: fingerprint, maximum: audioMaximum,
          expectedSize: knownSize, cancellation: cancellation, publicRedirects: allowRedirects, digest: LXFiles.hash,
          progress: { progress("downloading", $0, $1) }).start()
        if let a = a { try unchanged(a) }
      }
      try cancellation.check(); size = try LXFiles.size(partial); hash = try LXFiles.hash(partial)
      ext = try LXFiles.audioExtension(partial, hint: "")
      if let expected = source["sha256"] as? String, expected != hash { throw LXLibraryError("音频内容校验失败") }
      try LXFiles.write(["fingerprint": fingerprint, "size": String(size), "sha256": hash, "ext": ext], to: checked)
    }
    try cancellation.check()
    let name = LXFiles.filename(text(p, "name", fallback: "Audio"), suffix: jobId, ext: ext)
    let published: LXPublishedFile
    if destinationKind == "local" {
      let final = try LXFiles.child(paths.downloads, name)
      if LXFiles.fm.fileExists(atPath: final.path) {
        guard LXFiles.verified(final, size: size, hash: hash) else { throw LXLibraryError("本地同名文件内容不同，未覆盖") }
      } else { try LXFiles.fm.copyItem(at: partial, to: final) }
      guard LXFiles.verified(final, size: size, hash: hash) else { throw LXLibraryError("本地文件写入校验失败") }
      published = LXPublishedFile(kind: "local", path: name, accountId: nil, name: name, size: size, sha256: hash, ext: ext)
    } else {
      let a = try account(text(target, "accountId"))
      let final = try await publishDAV(partial, a: a, folder: text(target, "path"), name: name, size: size, hash: hash, cancellation: cancellation, progress: progress)
      published = LXPublishedFile(kind: "webdav", path: final, accountId: a.id, name: name, size: size, sha256: hash, ext: ext)
    }
    // Persist the receipt before returning. A crash before JS saves completion
    // does not require redownloading or overwriting the completed destination.
    try LXFiles.write(published, to: receiptFile)
    try? removeIfExists(partial, below: paths.library); try? removeIfExists(checked, below: paths.library)
    try? removeIfExists(partial.appendingPathExtension("resume.json"), below: paths.library)
    return try LXFiles.object(published)
  }
  func command(_ command: String, _ p: [String: Any], progress: @escaping Progress) async throws -> Any {
    if command == "restore.status" { return try LXFiles.object(restore.status()) }
    if command == "restore.ack" { return try LXFiles.object(restore.acknowledge()) }
    if command == "config.read" { return try publicConfig() }
    if command == "queue.read" {
      let f = paths.library.appendingPathComponent("queue.json")
      if !LXFiles.fm.fileExists(atPath: f.path) { return NSNull() }
      return try LXFiles.object(LXFiles.read([String: LXJSONValue].self, from: f))
    }
    if command == "playback.release" {
      let lease = text(p, "lease")
      if liveLeases.remove(lease) != nil { try removeIfExists(LXFiles.child(paths.leases, lease), below: paths.leases) }
      return true
    }
    try beginMutation()
    switch command {
    case "account.save":
      var c = try config(); let requested = text(p, "id"), id = requested.isEmpty ? UUID().uuidString.lowercased() : requested
      try LXFiles.requireID(id)
      let old = c.accounts.first { $0.id == id }
      guard c.accounts.count < 1000 || old != nil else { throw LXLibraryError("账户数量超出限制") }
      let endpoint = text(p, "endpoint").trimmingCharacters(in: .whitespacesAndNewlines), user = text(p, "username")
      let allowHTTP = p["allowHTTP"] as? Bool ?? false
      _ = try LXDAVRoot(endpoint, allowHTTP: allowHTTP)
      guard !user.contains(":"), !user.contains("\n"), user.utf8.count <= 4096 else { throw LXLibraryError("用户名格式无效") }
      let replacement = p["password"] as? String
      let changesIdentity = old == nil || old?.endpoint != endpoint || old?.username != user || old?.allowHTTP != allowHTTP || replacement != nil
      guard !changesIdentity || registry.count == 0 else { throw LXLibraryError("请先暂停下载并等待当前网络操作结束，再修改账户连接或密码") }
      let secret: String
      if let replacement = replacement {
        guard replacement.utf8.count <= 16384 else { throw LXLibraryError("密码过长") }
        secret = UUID().uuidString.lowercased(); try restore.vault.write(secret, value: Data(replacement.utf8))
      } else if let old = old { secret = old.secretRef }
      else { throw LXLibraryError("请填写密码；匿名账户可填写空密码") }
      let identityChanged = changesIdentity
      let a = LXLibraryAccount(id: id, name: String(text(p, "name", fallback: "WebDAV").prefix(100)), endpoint: endpoint, username: user, allowHTTP: allowHTTP,
        directoryCache: p["directoryCache"] as? Bool ?? true, audioCache: p["audioCache"] as? Bool ?? true,
        revision: identityChanged ? UUID().uuidString : old!.revision, secretRef: secret)
      c.accounts.removeAll { $0.id == id }; c.accounts.append(a)
      do { try LXFiles.write(c, to: paths.config) } catch { if replacement != nil { try? restore.vault.write(secret, value: nil) }; throw error }
      if let old = old, old.secretRef != secret { try? restore.vault.write(old.secretRef, value: nil) }
      return try publicConfig()
    case "account.remove":
      guard registry.count == 0 else { throw LXLibraryError("请先暂停下载并等待当前网络操作结束，再删除账户") }
      var c = try config(); let a = try account(text(p, "id")); c.accounts.removeAll { $0.id == a.id }
      try LXFiles.write(c, to: paths.config); try restore.vault.write(a.secretRef, value: nil)
      // Cache clearing is explicit and does not delete imported playlists.
      return try publicConfig()
    case "cache.limit":
      var c = try config(); guard let limit = p["megabytes"] as? Int, (0...32768).contains(limit) else { throw LXLibraryError("缓存上限须为0至32768 MB") }
      c.audioLimitMB = limit; try LXFiles.write(c, to: paths.config); try trimAudioCache(); return try publicConfig()
    case "cache.clear":
      guard activeTransfers.isEmpty, registry.count == 0 else { throw LXLibraryError("请先暂停下载和音乐准备，再清理缓存") }
      let kind = text(p, "kind"); guard ["audio", "directory"].contains(kind) else { throw LXLibraryError("缓存类型无效") }
      let folder = try paths.folder(kind + "-cache")
      for f in try LXFiles.fm.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil) { try removeIfExists(f, below: folder) }
      return true
    case "queue.save":
      guard let raw = p["json"] as? String, let data = raw.data(using: .utf8), data.count <= 16 * 1024 * 1024,
        let object = try JSONSerialization.jsonObject(with: data) as? [String: Any], object["schema"] as? Int == 1 else { throw LXLibraryError("下载队列数据格式无效") }
      try LXFiles.atomic(data, to: paths.library.appendingPathComponent("queue.json")); return true
    case "download.discardPartial":
      let id = text(p, "jobId"); try LXFiles.requireID(id)
      guard !activeTransfers.contains(id) else { throw LXLibraryError("请先暂停该下载") }
      for name in [id + ".part", id + ".part.resume.json", id + ".verified.json"] { try removeIfExists(file("transfers", name), below: paths.library) }
      return true
    case "file.local":
      let url = try LXFiles.child(paths.downloads, text(p, "path")); _ = try LXFiles.size(url); return url.path
    case "restore.arm": return try LXFiles.object(restore.arm(text(p, "id")))
    case "restore.cancel": try restore.cancel(text(p, "id")); return true
    default: break
    }
    let (operation, cancellation) = try token(p); defer { registry.end(operation) }
    try cancellation.check()
    switch command {
    case "directory.list":
      let a = try account(text(p, "accountId"))
      return try LXFiles.object(await directory(a, path: text(p, "path"), force: p["force"] as? Bool ?? false, cancellation: cancellation))
    case "playback.prepare":
      return try await playback(LXFiles.decode(LXLibraryReference.self, p["reference"] ?? [:]), cancellation: cancellation, progress: progress)
    case "download.run": return try await download(p, cancellation: cancellation, progress: progress)
    case "backup.create", "restore.stage":
      guard registry.count == 1 && activeTransfers.isEmpty else { throw LXLibraryError("请先暂停下载并等待其他文件操作完成") }
      exclusive = true; defer { exclusive = false }
      let password = text(p, "password")
      if command == "backup.create" {
        let (url, manifest) = try restore.createBackup(kind: text(p, "kind"), password: password, includeCaches: p["includeCaches"] as? Bool ?? true, cancellation: cancellation, progress: { progress("encrypting", $0, $1) })
        return ["path": url.path, "name": url.lastPathComponent, "size": try LXFiles.size(url), "sha256": try LXFiles.hash(url), "kind": manifest.kind]
      }
      return try LXFiles.object(restore.stage(archive: LXFiles.insideHome(text(p, "path"), paths: paths), password: password, cancellation: cancellation, progress: { progress("decrypting", $0, $1) }))
    case "backup.upload":
      let source = try LXFiles.insideHome(text(p, "path"), paths: paths)
      guard source.path.hasPrefix(paths.exports.path + "/"), source.pathExtension == "lxbackup" else { throw LXLibraryError("只允许上传由应用生成的加密备份") }
      let a = try account(text(p, "accountId")), n = try LXFiles.size(source), hash = try LXFiles.hash(source)
      let path = try await publishDAV(source, a: a, folder: text(p, "folder"), name: source.lastPathComponent, size: n, hash: hash, cancellation: cancellation, progress: progress)
      return ["path": path, "size": n, "sha256": hash]
    case "backup.fetch":
      let a = try account(text(p, "accountId")), remote = text(p, "path")
      guard remote.lowercased().hasSuffix(".lxbackup") else { throw LXLibraryError("请选择.lxbackup加密备份文件") }
      let local = paths.exports.appendingPathComponent("received-" + UUID().uuidString + ".lxbackup")
      do { try await client(a).download(remote, to: local, maxBytes: 64 * 1024 * 1024 * 1024, cancellation: cancellation, progress: { progress("downloading", $0, $1) }) }
      catch { try? removeIfExists(local, below: paths.exports); throw error }
      return ["path": local.path, "size": try LXFiles.size(local)]
    default: throw LXLibraryError("资料库操作不受支持")
    }
  }
}

/// JSON values used only for lossless queue transport. The JS queue validates
/// the schema and each job; malformed existing JSON is never silently reset.
indirect enum LXJSONValue: Codable {
  case string(String), number(Double), bool(Bool), object([String: LXJSONValue]), array([LXJSONValue]), null
  init(from decoder: Decoder) throws {
    let c = try decoder.singleValueContainer()
    if c.decodeNil() { self = .null }
    else if let v = try? c.decode(Bool.self) { self = .bool(v) }
    else if let v = try? c.decode(String.self) { self = .string(v) }
    else if let v = try? c.decode(Double.self) { self = .number(v) }
    else if let v = try? c.decode([String: LXJSONValue].self) { self = .object(v) }
    else { self = .array(try c.decode([LXJSONValue].self)) }
  }
  func encode(to encoder: Encoder) throws {
    var c = encoder.singleValueContainer()
    switch self { case .null: try c.encodeNil(); case .string(let v): try c.encode(v); case .number(let v): try c.encode(v)
    case .bool(let v): try c.encode(v); case .object(let v): try c.encode(v); case .array(let v): try c.encode(v) }
  }
}
