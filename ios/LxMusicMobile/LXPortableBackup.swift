import Foundation
import CryptoKit
import CommonCrypto
import Security

struct LXBackupEntry: Codable, Equatable {
  var path: String
  var directory: Bool
  var bytes: Int64
  var sha256: String?
}
struct LXBackupSecrets: Codable {
  var preferences: Data
  var passwords: [String: Data]
  var accounts: [LXLibraryAccount]
  var playlists: [String: String]?
}
struct LXBackupManifest: Codable {
  var schema = 1
  var minimumBuild = 88
  var application: String
  var version: String
  var build: Int
  var created: Double
  var sourceHome: String
  var kind: String
  var roots: [String]
  var entries: [LXBackupEntry]
  var secrets: LXBackupSecrets
}
private struct LXBackupHeader: Codable {
  var version = 1
  var algorithm = "AES-256-GCM/PBKDF2-HMAC-SHA256"
  var rounds: UInt32 = 600000
  var salt: Data
  var noncePrefix: Data
  var chunk = 1024 * 1024
}
private struct LXBackupEnd: Codable {
  var done = true
  var manifestSHA256: String
  var entries: Int
  var bytes: Int64
}

/// An authenticated, bounded-memory container. Header and sequence are AAD;
/// unique per-record nonces and an encrypted final record detect reordering,
/// truncation, replacement and trailing data. Account credentials are encrypted.
/// This encrypts data with the user's password; it never stores the password.
struct LXPortableBackup {
  static let magic = Data("LXBACK88".utf8)
  static let maxEntries = 100000
  static let maxTotal: Int64 = 64 * 1024 * 1024 * 1024
  static let chunk = 1024 * 1024
  static let maxManifest = 16 * 1024 * 1024

  static func random(_ count: Int) throws -> Data {
    var bytes = [UInt8](repeating: 0, count: count)
    guard SecRandomCopyBytes(kSecRandomDefault, count, &bytes) == errSecSuccess else { throw LXLibraryError("系统随机数不可用") }
    return Data(bytes)
  }
  static func key(password: String, salt: Data, rounds: UInt32 = 600000) throws -> SymmetricKey {
    let bytes = Array(password.utf8)
    guard password.count >= 10, bytes.count <= 1024, salt.count == 32, rounds == 600000 else {
      throw LXLibraryError("备份密码需要至少10个字符，且不超过1024个UTF-8字节；备份参数必须受支持")
    }
    var result = [UInt8](repeating: 0, count: 32)
    let status = bytes.withUnsafeBytes { passwordBuffer in
      salt.withUnsafeBytes { saltBuffer in
        CCKeyDerivationPBKDF(CCPBKDFAlgorithm(kCCPBKDF2), passwordBuffer.bindMemory(to: Int8.self).baseAddress,
          bytes.count, saltBuffer.bindMemory(to: UInt8.self).baseAddress, salt.count,
          CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256), rounds, &result, 32)
      }
    }
    guard status == kCCSuccess else { throw LXLibraryError("备份密钥生成失败") }
    let key = SymmetricKey(data: result)
    result.withUnsafeMutableBytes { $0.initializeMemory(as: UInt8.self, repeating: 0) }
    return key
  }
  private static func number(_ n: UInt64, length: Int) -> Data {
    Data((0..<length).reversed().map { UInt8((n >> ($0 * 8)) & 255) })
  }
  private static func readExact(_ h: FileHandle, _ count: Int) throws -> Data {
    guard count >= 0, count <= maxManifest + 28 else { throw LXLibraryError("备份记录长度无效") }
    var value = Data()
    while value.count < count {
      let bytes = try h.read(upToCount: count - value.count) ?? Data()
      guard !bytes.isEmpty else { throw LXLibraryError("备份文件被截断") }
      value.append(bytes)
    }
    return value
  }
  private static func readLength(_ h: FileHandle, maximum: Int) throws -> Int {
    let data = try readExact(h, 4)
    let n = data.reduce(UInt64(0)) { ($0 << 8) | UInt64($1) }
    guard n <= maximum else { throw LXLibraryError("备份记录超过安全限制") }
    return Int(n)
  }
  static func validate(_ manifest: LXBackupManifest, application: String, build: Int) throws -> Int64 {
    guard manifest.schema == 1, manifest.minimumBuild <= build, manifest.minimumBuild >= 88,
      manifest.application == application, ["full", "playlists"].contains(manifest.kind),
      manifest.entries.count <= maxEntries, manifest.sourceHome.hasPrefix("/"), manifest.sourceHome.utf8.count <= 8192,
      Set(manifest.roots).count == manifest.roots.count,
      Set(manifest.roots).isSubset(of: ["documents", "support", "caches"]),
      manifest.kind == "full" ? Set(["documents", "support"]).isSubset(of: Set(manifest.roots)) : manifest.roots.isEmpty,
      manifest.kind == "full" ? manifest.secrets.playlists == nil : manifest.secrets.playlists != nil else {
      throw LXLibraryError("备份格式、应用标识或版本不兼容")
    }
    if manifest.kind == "full" {
      let roots = Set(manifest.entries.filter { $0.directory && manifest.roots.contains($0.path) }.map { $0.path })
      guard roots == Set(manifest.roots) else { throw LXLibraryError("完整备份根目录缺失或不是目录") }
    }
    var seen = Set<String>(); var files = Set<String>(); var total: Int64 = 0
    for entry in manifest.entries {
      let parts = try LXFiles.parts(entry.path)
      guard manifest.roots.contains(parts[0]), entry.bytes >= 0, entry.bytes <= maxTotal - total else { throw LXLibraryError("备份路径或大小无效") }
      let key = entry.path.precomposedStringWithCanonicalMapping.lowercased()
      guard seen.insert(key).inserted else { throw LXLibraryError("备份中存在重复或大小写冲突路径") }
      var prefix = ""
      for part in parts.dropLast() {
        prefix += (prefix.isEmpty ? "" : "/") + part.precomposedStringWithCanonicalMapping.lowercased()
        guard !files.contains(prefix) else { throw LXLibraryError("备份目录与文件冲突") }
      }
      if entry.directory {
        guard entry.bytes == 0, entry.sha256 == nil else { throw LXLibraryError("备份目录记录无效") }
      } else {
        guard let hash = entry.sha256, hash.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
          !seen.contains(where: { $0.hasPrefix(key + "/") }) else { throw LXLibraryError("备份校验记录无效") }
        files.insert(key); total += entry.bytes
      }
    }
    if manifest.kind == "playlists" && !manifest.entries.isEmpty { throw LXLibraryError("歌单备份不能包含文件系统根目录") }
    guard manifest.secrets.passwords.count <= 1000, manifest.secrets.accounts.count <= 1000,
      manifest.secrets.preferences.count <= 8 * 1024 * 1024,
      Set(manifest.secrets.accounts.map { $0.id }).count == manifest.secrets.accounts.count,
      Set(manifest.secrets.accounts.map { $0.secretRef }).count == manifest.secrets.accounts.count else { throw LXLibraryError("备份配置数据超过限制") }
    for account in manifest.secrets.accounts {
      try LXFiles.requireID(account.id); try LXFiles.requireID(account.secretRef)
      _ = try LXDAVRoot(account.endpoint, allowHTTP: account.allowHTTP)
      guard manifest.secrets.passwords[account.secretRef] != nil else { throw LXLibraryError("备份账户凭据不完整") }
    }
    return total
  }
  static func inventory(_ roots: [String: URL], cancellation: LXDAVCancellation = LXDAVCancellation()) throws -> [LXBackupEntry] {
    var entries: [LXBackupEntry] = []; var bytes: Int64 = 0
    func walk(_ url: URL, _ relative: String) throws {
      try cancellation.check(); _ = try LXFiles.parts(relative)
      guard entries.count < maxEntries else { throw LXLibraryError("备份文件数量超过限制") }
      let attrs = try url.resourceValues(forKeys: [.isSymbolicLinkKey, .isRegularFileKey, .isDirectoryKey])
      guard attrs.isSymbolicLink != true else { throw LXLibraryError("完整备份遇到符号链接，未跳过或改动源文件") }
      if attrs.isDirectory == true {
        entries.append(LXBackupEntry(path: relative, directory: true, bytes: 0, sha256: nil))
        let children = try LXFiles.fm.contentsOfDirectory(at: url, includingPropertiesForKeys: nil).sorted { $0.lastPathComponent < $1.lastPathComponent }
        for child in children { try walk(child, relative + "/" + child.lastPathComponent) }
      } else {
        guard attrs.isRegularFile == true else { throw LXLibraryError("完整备份遇到不支持的文件类型") }
        let size = try LXFiles.size(url)
        guard size <= maxTotal - bytes else { throw LXLibraryError("备份总大小超过64GB限制") }
        bytes += size
        entries.append(LXBackupEntry(path: relative, directory: false, bytes: size, sha256: try LXFiles.hash(url)))
      }
    }
    for name in roots.keys.sorted() {
      let root = roots[name]!
      if LXFiles.fm.fileExists(atPath: root.path) { try walk(root, name) }
      else { entries.append(LXBackupEntry(path: name, directory: true, bytes: 0, sha256: nil)) }
    }
    return entries
  }
  static func create(_ manifest: LXBackupManifest, roots: [String: URL], password: String, output: URL,
                     cancellation: LXDAVCancellation, progress: ((Int64, Int64) -> Void)? = nil) throws {
    let total = try validate(manifest, application: manifest.application, build: manifest.build)
    let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
    let manifestData = try encoder.encode(manifest)
    guard manifestData.count <= maxManifest else { throw LXLibraryError("备份目录清单过大") }
    let header = LXBackupHeader(salt: try random(32), noncePrefix: try random(4))
    let headerData = try encoder.encode(header)
    let aad = magic + number(UInt64(headerData.count), length: 4) + headerData
    let secret = try key(password: password, salt: header.salt)
    guard !LXFiles.fm.fileExists(atPath: output.path) else { throw LXLibraryError("备份目标已存在，不覆盖已有备份") }
    try LXFiles.mkdir(output.deletingLastPathComponent())
    try LXFiles.requireSpace(at: output.deletingLastPathComponent(), bytes: total + Int64(manifestData.count) + total / 100)
    guard LXFiles.fm.createFile(atPath: output.path, contents: nil, attributes: [.posixPermissions: 0o600]) else { throw LXLibraryError("无法创建备份文件") }
    let h = try FileHandle(forWritingTo: output)
    var success = false
    defer { try? h.close(); if !success { try? LXFiles.fm.removeItem(at: output) } }
    try h.write(contentsOf: aad)
    var sequence: UInt64 = 0
    func writeRecord(_ data: Data) throws {
      try cancellation.check()
      guard sequence < UInt64.max else { throw LXLibraryError("备份记录过多") }
      let nonce = try AES.GCM.Nonce(data: header.noncePrefix + number(sequence, length: 8))
      let sealed = try AES.GCM.seal(data, using: secret, nonce: nonce, authenticating: aad + number(sequence, length: 8))
      guard let bytes = sealed.combined else { throw LXLibraryError("备份加密失败") }
      try h.write(contentsOf: number(UInt64(bytes.count), length: 4)); try h.write(contentsOf: bytes)
      sequence += 1
    }
    try writeRecord(manifestData)
    var done: Int64 = 0
    for entry in manifest.entries where !entry.directory {
      let parts = try LXFiles.parts(entry.path)
      guard let root = roots[parts[0]] else { throw LXLibraryError("备份根目录缺失") }
      let source = try LXFiles.child(root, parts.dropFirst().joined(separator: "/"))
      let input = try FileHandle(forReadingFrom: source); defer { try? input.close() }
      var hash = SHA256(); var count: Int64 = 0
      while count < entry.bytes {
        let bytes = try readExact(input, Int(min(Int64(chunk), entry.bytes - count)))
        guard !bytes.isEmpty else { throw LXLibraryError("备份期间源文件被截断，请重试") }
        hash.update(data: bytes); count += Int64(bytes.count); done += Int64(bytes.count)
        try writeRecord(bytes); progress?(done, total)
      }
      let trailing = try input.read(upToCount: 1) ?? Data()
      guard trailing.isEmpty, hash.finalize().map({ String(format: "%02x", $0) }).joined() == entry.sha256 else {
        throw LXLibraryError("备份期间源文件发生变化，请暂停操作后重试")
      }
      try input.close()
    }
    // A source outside AsyncStorage may change while native work runs. Reject
    // rather than publish a mixed-time snapshot. The JS storage/list gates keep
    // all durable list/settings mutations outside this interval.
    guard try inventory(roots, cancellation: cancellation) == manifest.entries else {
      throw LXLibraryError("备份期间文件集合发生变化，请重试")
    }
    let end = LXBackupEnd(manifestSHA256: LXFiles.hash(manifestData), entries: manifest.entries.count, bytes: total)
    try writeRecord(encoder.encode(end)); try h.synchronize(); try h.close()
    success = true; progress?(total, total)
  }
  static func extract(_ archive: URL, password: String, staging: URL, application: String, build: Int,
                      cancellation: LXDAVCancellation, progress: ((Int64, Int64) -> Void)? = nil) throws -> LXBackupManifest {
    guard try LXFiles.size(archive) <= maxTotal + Int64(maxManifest) + maxTotal / 100 else { throw LXLibraryError("备份文件过大") }
    let h = try FileHandle(forReadingFrom: archive); defer { try? h.close() }
    guard try readExact(h, magic.count) == magic else { throw LXLibraryError("不是支持的加密备份文件") }
    let headerSize = try readLength(h, maximum: 4096)
    let headerData = try readExact(h, headerSize)
    let header = try JSONDecoder().decode(LXBackupHeader.self, from: headerData)
    guard header.version == 1, header.algorithm == "AES-256-GCM/PBKDF2-HMAC-SHA256", header.rounds == 600000,
      header.chunk == chunk, header.salt.count == 32, header.noncePrefix.count == 4 else { throw LXLibraryError("备份加密格式不受支持") }
    let aad = magic + number(UInt64(headerSize), length: 4) + headerData
    let secret = try key(password: password, salt: header.salt, rounds: header.rounds)
    var sequence: UInt64 = 0
    func readRecord(_ maximum: Int) throws -> Data {
      try cancellation.check()
      let count = try readLength(h, maximum: maximum + 28)
      guard count >= 28 else { throw LXLibraryError("备份记录无效") }
      let combined = try readExact(h, count)
      do {
        let box = try AES.GCM.SealedBox(combined: combined)
        guard Data(box.nonce) == header.noncePrefix + number(sequence, length: 8) else { throw LXLibraryError("备份记录顺序不正确") }
        let bytes = try AES.GCM.open(box, using: secret, authenticating: aad + number(sequence, length: 8))
        sequence += 1; return bytes
      } catch { throw LXLibraryError("密码错误或备份完整性校验失败") }
    }
    let manifestData = try readRecord(maxManifest)
    let manifest = try JSONDecoder().decode(LXBackupManifest.self, from: manifestData)
    let total = try validate(manifest, application: application, build: build)
    guard !LXFiles.fm.fileExists(atPath: staging.path) else { throw LXLibraryError("恢复暂存目录已存在") }
    try LXFiles.mkdir(staging)
    var success = false
    defer { if !success { try? LXFiles.fm.removeItem(at: staging) } }
    try LXFiles.requireSpace(at: staging, bytes: total)
    var done: Int64 = 0
    for entry in manifest.entries {
      let target = try LXFiles.child(staging, entry.path)
      if entry.directory { try LXFiles.mkdir(target); continue }
      try LXFiles.mkdir(target.deletingLastPathComponent())
      guard !LXFiles.fm.fileExists(atPath: target.path), LXFiles.fm.createFile(atPath: target.path, contents: nil, attributes: [.posixPermissions: 0o600]) else {
        throw LXLibraryError("恢复路径冲突")
      }
      let output = try FileHandle(forWritingTo: target); defer { try? output.close() }
      var bytes: Int64 = 0; var hash = SHA256()
      while bytes < entry.bytes {
        let data = try readRecord(chunk)
        guard data.count == Int(min(Int64(chunk), entry.bytes - bytes)) else { throw LXLibraryError("备份分块长度错误") }
        try output.write(contentsOf: data); hash.update(data: data); bytes += Int64(data.count); done += Int64(data.count)
        progress?(done, total)
      }
      try output.synchronize(); try output.close()
      guard hash.finalize().map({ String(format: "%02x", $0) }).joined() == entry.sha256 else { throw LXLibraryError("恢复文件校验失败") }
      #if os(iOS)
      try LXFiles.fm.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: target.path)
      #endif
    }
    let end = try JSONDecoder().decode(LXBackupEnd.self, from: readRecord(4096))
    guard end.done, end.manifestSHA256 == LXFiles.hash(manifestData), end.entries == manifest.entries.count, end.bytes == total,
      (try h.read(upToCount: 1) ?? Data()).isEmpty else { throw LXLibraryError("备份结束标记或长度校验失败") }
    success = true; return manifest
  }
}
