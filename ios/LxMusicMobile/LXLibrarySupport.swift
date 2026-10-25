import Foundation
import CryptoKit
import Security

struct LXLibraryError: Error, LocalizedError {
  let message: String
  init(_ message: String) { self.message = message }
  var errorDescription: String? { message }
}

struct LXLibraryAccount: Codable, Equatable {
  var id: String
  var name: String
  var endpoint: String
  var username: String
  var allowHTTP: Bool
  var directoryCache: Bool
  var audioCache: Bool
  var revision: String
  // An immutable, versioned Keychain item. Replacing config cannot expose a
  // half-written password update; a crash can at worst leave an unused item.
  var secretRef: String
}
struct LXLibraryConfig: Codable {
  var schema = 1
  var accounts: [LXLibraryAccount] = []
  var audioLimitMB = 512
}
struct LXLibraryReference: Codable, Equatable {
  var kind: String
  var accountId: String?
  var path: String
  var etag: String?
  var size: Int64?
  var sha256: String?
}
struct LXPublishedFile: Codable, Equatable {
  var kind: String
  var path: String
  var accountId: String?
  var name: String
  var size: Int64
  var sha256: String
  var ext: String
}
struct LXAudioCacheRecord: Codable {
  var file: String
  var size: Int64
  var sha256: String
  var accessed: Double
  var accountId: String
}
struct LXDirectoryCacheRecord: Codable {
  var created: Double
  var entries: [LXDAVEntry]
}

struct LXLibraryPaths {
  let home: URL
  var documents: URL { home.appendingPathComponent("Documents", isDirectory: true) }
  var support: URL { home.appendingPathComponent("Library/Application Support", isDirectory: true) }
  var caches: URL { home.appendingPathComponent("Library/Caches", isDirectory: true) }
  var library: URL { support.appendingPathComponent("LXLibraryV1", isDirectory: true) }
  var downloads: URL { documents.appendingPathComponent("LX Downloads", isDirectory: true) }
  var exports: URL { home.appendingPathComponent("Library/LXBackupExports", isDirectory: true) }
  var transactions: URL { home.appendingPathComponent("Library/LXRestoreTransaction", isDirectory: true) }
  var leases: URL { home.appendingPathComponent("tmp/LXLibraryPlayback", isDirectory: true) }
  var config: URL { library.appendingPathComponent("accounts.json") }
  init(home: URL = URL(fileURLWithPath: NSHomeDirectory(), isDirectory: true)) {
    self.home = home.standardizedFileURL.resolvingSymlinksInPath()
  }
  func folder(_ name: String) throws -> URL {
    let url = try LXFiles.child(library, name)
    try LXFiles.mkdir(url)
    return url
  }
  func initialize() throws {
    for path in [documents, support, caches, library, downloads, exports, transactions, leases] { try LXFiles.mkdir(path) }
    for name in ["transfers", "receipts", "directory-cache", "audio-cache"] { _ = try folder(name) }
  }
}

enum LXFiles {
  static let fm = FileManager.default
  static func validID(_ id: String) -> Bool {
    id.range(of: "^[A-Za-z0-9_-]{1,100}$", options: .regularExpression) != nil
  }
  static func requireID(_ id: String) throws {
    guard validID(id) else { throw LXLibraryError("操作标识无效") }
  }
  static func parts(_ path: String, allowEmpty: Bool = false) throws -> [String] {
    guard path.utf8.count <= 8192, !path.hasPrefix("/"), !path.contains("\\"),
      !path.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) else {
      throw LXLibraryError("文件路径不安全")
    }
    if path.isEmpty && allowEmpty { return [] }
    let parts = path.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
    guard !parts.isEmpty, parts.count <= 64, parts.allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." && $0.utf8.count <= 255 }) else {
      throw LXLibraryError("文件路径不安全")
    }
    return parts
  }
  static func child(_ root: URL, _ relative: String) throws -> URL {
    let parts = try self.parts(relative)
    let result = parts.reduce(root) { $0.appendingPathComponent($1) }.standardizedFileURL
    let realRoot = root.standardizedFileURL.resolvingSymlinksInPath().path
    let realPath = result.resolvingSymlinksInPath().path
    guard realPath.hasPrefix(realRoot + "/") else { throw LXLibraryError("文件路径超出应用目录") }
    return result
  }
  static func insideHome(_ text: String, paths: LXLibraryPaths) throws -> URL {
    let url: URL
    if text.hasPrefix("file:") {
      guard let parsed = URL(string: text), parsed.isFileURL, parsed.host == nil || parsed.host == "" || parsed.host == "localhost" else {
        throw LXLibraryError("只支持应用内文件")
      }
      url = parsed
    } else { url = URL(fileURLWithPath: text) }
    let normalized = url.standardizedFileURL.resolvingSymlinksInPath()
    guard normalized.path.hasPrefix(paths.home.path + "/") else { throw LXLibraryError("文件不在应用目录内，请先导入文件") }
    return normalized
  }
  static func mkdir(_ url: URL) throws {
    if fm.fileExists(atPath: url.path) {
      let values = try url.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
      guard values.isDirectory == true, values.isSymbolicLink != true else { throw LXLibraryError("目标不是安全目录") }
      return
    }
    try fm.createDirectory(at: url, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
  }
  static func atomic(_ data: Data, to url: URL) throws {
    try mkdir(url.deletingLastPathComponent())
    try data.write(to: url, options: .atomic)
    try fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    #if os(iOS)
    try fm.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: url.path)
    #endif
  }
  static func write<T: Encodable>(_ value: T, to url: URL) throws {
    let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
    try atomic(encoder.encode(value), to: url)
  }
  static func read<T: Decodable>(_ type: T.Type, from url: URL, max: Int64 = 32 * 1024 * 1024) throws -> T {
    guard try size(url) <= max else { throw LXLibraryError("数据文件过大") }
    return try JSONDecoder().decode(type, from: Data(contentsOf: url))
  }
  static func size(_ url: URL) throws -> Int64 {
    // URL resource values are cached. A resumable transfer intentionally keeps
    // the same file URL while its verified prefix grows, so a cached fileSize
    // can describe the old prefix after the FileHandle has appended new bytes.
    // FileManager attributes read the current filesystem metadata and preserve
    // the existing fail-closed rejection of symlinks/non-regular files.
    let attributes = try fm.attributesOfItem(atPath: url.path)
    guard attributes[.type] as? FileAttributeType == .typeRegular,
      let bytes = attributes[.size] as? NSNumber else {
      throw LXLibraryError("文件类型不安全或文件不存在")
    }
    return bytes.int64Value
  }
  static func hash(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
  static func hash(_ file: URL) throws -> String {
    _ = try size(file)
    let handle = try FileHandle(forReadingFrom: file); defer { try? handle.close() }
    var hasher = SHA256()
    while let data = try handle.read(upToCount: 1024 * 1024), !data.isEmpty { hasher.update(data: data) }
    return hasher.finalize().map { String(format: "%02x", $0) }.joined()
  }
  static func verified(_ file: URL, size expected: Int64, hash expectedHash: String) -> Bool {
    guard expected >= 0, expectedHash.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else { return false }
    return (try? size(file)) == expected && (try? hash(file)) == expectedHash
  }
  static func object<T: Encodable>(_ value: T) throws -> Any { try JSONSerialization.jsonObject(with: JSONEncoder().encode(value)) }
  static func decode<T: Decodable>(_ type: T.Type, _ value: Any) throws -> T {
    try JSONDecoder().decode(type, from: JSONSerialization.data(withJSONObject: value))
  }
  static func removeOwned(_ file: URL, below root: URL) throws {
    let checked = try child(root, String(file.standardizedFileURL.path.dropFirst(root.standardizedFileURL.path.count + 1)))
    guard checked.standardizedFileURL == file.standardizedFileURL else { throw LXLibraryError("不能清理非应用管理的文件") }
    if fm.fileExists(atPath: file.path) { try fm.removeItem(at: file) }
  }
  static func filename(_ input: String, suffix: String, ext: String) -> String {
    let trimmed = input.precomposedStringWithCanonicalMapping
      .components(separatedBy: CharacterSet(charactersIn: "/\\:*?\"<>|").union(.controlCharacters)).joined(separator: "_")
      .trimmingCharacters(in: CharacterSet.whitespacesAndNewlines.union(CharacterSet(charactersIn: ".")))
    // UTF-8 rather than Character limits protect the filesystem's component limit.
    var stem = trimmed.isEmpty ? "Audio" : trimmed
    while stem.utf8.count > 140 { stem.removeLast() }
    return "\(stem)-\(suffix).\(ext)"
  }
  static func audioExtension(_ file: URL, hint: String) throws -> String {
    let h = try FileHandle(forReadingFrom: file); defer { try? h.close() }
    let d = try h.read(upToCount: 4096) ?? Data(); let b = [UInt8](d)
    guard b.count >= 16 else { throw LXLibraryError("音频文件为空或不完整") }
    if d.starts(with: Data("fLaC".utf8)) { return "flac" }
    if d.starts(with: Data("ID3".utf8)) || (b[0] == 0xff && (b[1] & 0xe0) == 0xe0 && (b[1] & 0x06) != 0) { return "mp3" }
    if d.starts(with: Data("RIFF".utf8)) && d.subdata(in: 8..<12) == Data("WAVE".utf8) { return "wav" }
    if d.subdata(in: 4..<8) == Data("ftyp".utf8) { return "m4a" }
    if d.starts(with: Data("FORM".utf8)) && ["AIFF", "AIFC"].contains(String(data: d.subdata(in: 8..<12), encoding: .ascii) ?? "") { return "aiff" }
    if b[0] == 0xff && (b[1] & 0xf6) == 0xf0 { return "aac" }
    throw LXLibraryError("下载内容不是支持的音频文件（MP3、FLAC、M4A、AAC、WAV、AIFF）")
  }
  static func requireSpace(at url: URL, bytes: Int64) throws {
    let attrs = try fm.attributesOfFileSystem(forPath: url.path)
    let free = (attrs[.systemFreeSize] as? NSNumber)?.int64Value ?? 0
    guard bytes >= 0, free > bytes + 16 * 1024 * 1024 else { throw LXLibraryError("可用空间不足，请先清理空间") }
  }
}

// Error diagnostics contain only the fixed operation and numeric OSStatus.
// Never interpolate service/account names, passwords, queries or secret bytes.
struct LXKeychainFailure: Error, LocalizedError {
  enum Operation: String { case read, update, add, delete, snapshot }
  let operation: Operation
  let status: OSStatus
  var errorDescription: String? { "钥匙串操作失败（\(operation.rawValue)，OSStatus=\(status)）" }
}

protocol LXSecretVault {
  func read(_ key: String) throws -> Data?
  func write(_ key: String, value: Data?) throws
  func all() throws -> [String: Data]
}
final class LXKeychainVault: LXSecretVault {
  let service: String
  init(service: String) { self.service = service }
  private func query(_ key: String? = nil) -> [String: Any] {
    var q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                           kSecAttrSynchronizable as String: false]
    if let key = key { q[kSecAttrAccount as String] = key }
    return q
  }
  func read(_ key: String) throws -> Data? {
    var q = query(key); q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
    var value: CFTypeRef?; let status = SecItemCopyMatching(q as CFDictionary, &value)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess, let data = value as? Data else { throw LXKeychainFailure(operation: .read, status: status) }
    return data
  }
  func write(_ key: String, value: Data?) throws {
    let q = query(key)
    guard let value = value else {
      let status = SecItemDelete(q as CFDictionary)
      guard status == errSecSuccess || status == errSecItemNotFound else { throw LXKeychainFailure(operation: .delete, status: status) }
      return
    }
    let status = SecItemUpdate(q as CFDictionary, [kSecValueData as String: value] as CFDictionary)
    if status == errSecItemNotFound {
      var item = q; item[kSecValueData as String] = value
      // Background audio may need the next WebDAV song after the device locks.
      // This-device-only, after-first-unlock protection permits that legitimate
      // use without making credentials transferable through system backups.
      item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
      let addStatus = SecItemAdd(item as CFDictionary, nil)
      guard addStatus == errSecSuccess else { throw LXKeychainFailure(operation: .add, status: addStatus) }
    } else if status != errSecSuccess { throw LXKeychainFailure(operation: .update, status: status) }
  }
  func all() throws -> [String: Data] {
    var q = query(); q[kSecReturnAttributes as String] = true; q[kSecReturnData as String] = true
    q[kSecMatchLimit as String] = kSecMatchLimitAll
    var result: CFTypeRef?; let status = SecItemCopyMatching(q as CFDictionary, &result)
    if status == errSecItemNotFound { return [:] }
    guard status == errSecSuccess, let items = result as? [[String: Any]] else { throw LXKeychainFailure(operation: .snapshot, status: status) }
    var values: [String: Data] = [:]
    for item in items {
      guard let key = item[kSecAttrAccount as String] as? String, let value = item[kSecValueData as String] as? Data else {
        throw LXLibraryError("钥匙串数据不完整")
      }
      values[key] = value
    }
    return values
  }
}

final class LXOperationRegistry {
  private let lock = NSLock()
  private var active: [String: LXDAVCancellation] = [:]
  private var earlyCancelled: [String] = []
  func begin(_ id: String) throws -> LXDAVCancellation {
    try LXFiles.requireID(id); lock.lock(); defer { lock.unlock() }
    guard active[id] == nil else { throw LXLibraryError("操作正在执行") }
    let token = LXDAVCancellation()
    if earlyCancelled.contains(id) { token.cancel() }
    active[id] = token
    return token
  }
  func end(_ id: String) { lock.lock(); active.removeValue(forKey: id); earlyCancelled.removeAll { $0 == id }; lock.unlock() }
  func cancel(_ id: String) {
    lock.lock(); let token = active[id]
    if token == nil { earlyCancelled.append(id); if earlyCancelled.count > 256 { earlyCancelled.removeFirst() } }
    lock.unlock(); token?.cancel()
  }
  var count: Int { lock.lock(); defer { lock.unlock() }; return active.count }
}
