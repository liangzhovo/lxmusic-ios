import Foundation
import CryptoKit

protocol LXPreferenceStore {
  func read() throws -> Data
  func write(_ data: Data) throws
}
final class LXAppPreferences: LXPreferenceStore {
  let bundle: String
  init(bundle: String) { self.bundle = bundle }
  func read() throws -> Data {
    try PropertyListSerialization.data(fromPropertyList: UserDefaults.standard.persistentDomain(forName: bundle) ?? [:], format: .binary, options: 0)
  }
  func write(_ data: Data) throws {
    guard let values = try PropertyListSerialization.propertyList(from: data, options: [], format: nil) as? [String: Any] else {
      throw LXLibraryError("备份偏好设置格式无效")
    }
    UserDefaults.standard.setPersistentDomain(values, forName: bundle)
    guard UserDefaults.standard.synchronize() else { throw LXLibraryError("偏好设置未能持久化，保留恢复回滚数据") }
  }
}
private struct LXRestoreMapping: Codable {
  var name: String
  var live: String
  var started = false
  var oldExisted = false
}
private struct LXRestoreJournal: Codable {
  var schema = 1
  var id: String
  var state: String
  var manifest: LXBackupManifest
  var mappings: [LXRestoreMapping]
  var stagedEntries: [LXBackupEntry]
  var oldSecrets: LXBackupSecrets?
  var desiredSecrets: LXBackupSecrets?
}
struct LXRestoreOutcome: Codable {
  var state: String
  var message: String
  var id: String?
  var kind: String?
  var files: Int?
  var bytes: Int64?
  var created: Double?
}

/// Restore is a journaled cold-start transaction, before RCTBridge or
/// AsyncStorage opens. Current roots are renamed to a retained rollback area;
/// no original root is deleted until the newly initialized application acks.
final class LXRestoreCoordinator {
  let paths: LXLibraryPaths
  let bundle: String
  let build: Int
  let version: String
  let vault: LXSecretVault
  let journalVault: LXSecretVault
  let preferences: LXPreferenceStore
  private let failpoint: ((String) throws -> Void)?
  private var journalFile: URL { paths.transactions.appendingPathComponent("pending.lxj") }
  private var outcomeFile: URL { paths.transactions.appendingPathComponent("last-result.json") }
  private var journalAAD: Data { Data((bundle + "/restore-journal/v1").utf8) }
  init(paths: LXLibraryPaths, bundle: String, version: String, build: Int, vault: LXSecretVault,
       journalVault: LXSecretVault, preferences: LXPreferenceStore, failpoint: ((String) throws -> Void)? = nil) {
    self.paths = paths; self.bundle = bundle; self.version = version; self.build = build
    self.vault = vault; self.journalVault = journalVault; self.preferences = preferences; self.failpoint = failpoint
  }
  private func deviceKey(create: Bool) throws -> SymmetricKey {
    if let key = try journalVault.read("restore-v1") {
      guard key.count == 32 else { throw LXLibraryError("恢复事务密钥无效") }
      return SymmetricKey(data: key)
    }
    guard create else { throw LXLibraryError("恢复事务密钥不可用，请勿删除现有数据") }
    let key = try LXPortableBackup.random(32); try journalVault.write("restore-v1", value: key)
    return SymmetricKey(data: key)
  }
  private func save(_ journal: LXRestoreJournal) throws {
    let data = try JSONEncoder().encode(journal)
    let sealed = try AES.GCM.seal(data, using: deviceKey(create: true), authenticating: journalAAD)
    guard let encoded = sealed.combined else { throw LXLibraryError("恢复事务加密失败") }
    try LXFiles.atomic(encoded, to: journalFile)
  }
  private func read() throws -> LXRestoreJournal? {
    if !LXFiles.fm.fileExists(atPath: journalFile.path) { return nil }
    guard try LXFiles.size(journalFile) <= 32 * 1024 * 1024 else { throw LXLibraryError("恢复事务记录过大") }
    let data = try AES.GCM.open(AES.GCM.SealedBox(combined: Data(contentsOf: journalFile)), using: deviceKey(create: false), authenticating: journalAAD)
    let journal = try JSONDecoder().decode(LXRestoreJournal.self, from: data)
    try LXFiles.requireID(journal.id)
    guard journal.schema == 1, ["prepared", "ready", "applying", "awaitingAck", "acknowledged"].contains(journal.state) else {
      throw LXLibraryError("恢复事务状态不受支持")
    }
    _ = try LXPortableBackup.validate(journal.manifest, application: bundle, build: build)
    for mapping in journal.mappings {
      guard allowedMappings()[mapping.name] == mapping.live else { throw LXLibraryError("恢复事务路径未获授权") }
    }
    guard Set(journal.mappings.map { $0.name }).count == journal.mappings.count else { throw LXLibraryError("恢复事务包含重复根目录") }
    return journal
  }
  private func allowedMappings() -> [String: String] {
    ["documents": "Documents", "support": "Library/Application Support", "caches": "Library/Caches",
     "storage": "Library/Application Support/\(bundle)/\(LXStorageSnapshot.backend)",
     "accounts": "Library/Application Support/LXLibraryV1/accounts.json"]
  }
  private func area(_ journal: LXRestoreJournal, _ which: String, _ name: String) throws -> URL {
    try LXFiles.child(paths.transactions, journal.id + "/" + which + "/" + name)
  }
  private func live(_ mapping: LXRestoreMapping) throws -> URL { try LXFiles.child(paths.home, mapping.live) }
  private func fileExists(_ url: URL) -> Bool { LXFiles.fm.fileExists(atPath: url.path) }
  private func configuration(_ file: URL) throws -> LXLibraryConfig {
    if !fileExists(file) { return LXLibraryConfig() }
    let config = try LXFiles.read(LXLibraryConfig.self, from: file)
    guard config.schema == 1, config.accounts.count <= 1000 else { throw LXLibraryError("WebDAV配置版本不兼容") }
    return config
  }
  private func replaceSecrets(_ wanted: LXBackupSecrets) throws {
    // This vault service belongs only to this app's WebDAV accounts. Other
    // Keychain services, Apple credentials, signing and system permissions are
    // deliberately not enumerated or touched.
    let old = try vault.all()
    for (key, value) in wanted.passwords { try vault.write(key, value: value) }
    for key in old.keys where wanted.passwords[key] == nil { try vault.write(key, value: nil) }
    try preferences.write(wanted.preferences)
  }
  private func captureSecrets() throws -> LXBackupSecrets {
    LXBackupSecrets(preferences: try preferences.read(), passwords: try vault.all(), accounts: try configuration(paths.config).accounts, playlists: nil)
  }
  func status() throws -> LXRestoreOutcome {
    if let journal = try read() {
      return LXRestoreOutcome(state: journal.state, message: journal.state == "awaitingAck" ? "数据已恢复，正在验证启动" : "恢复已暂存，确认后在下次冷启动应用",
        id: journal.id, kind: journal.manifest.kind, files: journal.manifest.entries.filter { !$0.directory }.count,
        bytes: journal.manifest.entries.reduce(0) { $0 + $1.bytes }, created: journal.manifest.created)
    }
    return (try? LXFiles.read(LXRestoreOutcome.self, from: outcomeFile)) ?? LXRestoreOutcome(state: "none", message: "没有待恢复事务")
  }
  func createBackup(kind: String, password: String, includeCaches: Bool, cancellation: LXDAVCancellation,
                    progress: ((Int64, Int64) -> Void)? = nil) throws -> (URL, LXBackupManifest) {
    guard try read() == nil else { throw LXLibraryError("存在待恢复事务，请先取消或完成恢复") }
    guard kind == "full" || kind == "playlists" else { throw LXLibraryError("备份类型无效") }
    try paths.initialize()
    let initialPreferences = try preferences.read()
    var secrets = try captureSecrets()
    var roots: [String: URL] = [:]
    if kind == "full" {
      roots = ["documents": paths.documents, "support": paths.support]
      if includeCaches { roots["caches"] = paths.caches }
    } else {
      let values = try LXStorageSnapshot.read(LXStorageSnapshot.storageURL(support: paths.support, bundle: bundle))
      var playlistValues = values.filter { LXStorageSnapshot.isPlaylist($0.key) }
      if playlistValues["@user_list"] == nil { playlistValues["@user_list"] = "[]" }
      for id in ["default", "love"] { if playlistValues["@list__" + id] == nil { playlistValues["@list__" + id] = "[]" } }
      try LXStorageSnapshot.validatePlaylists(playlistValues)
      secrets.playlists = playlistValues
      // Only accounts actually referenced by a backed-up song need to travel
      // with a playlist-only backup. Full backups include the whole own vault.
      var accountIDs = Set<String>()
      func find(_ value: Any) {
        if let array = value as? [Any] { array.forEach(find) }
        else if let object = value as? [String: Any] {
          if object["kind"] as? String == "webdav", let id = object["accountId"] as? String { accountIDs.insert(id) }
          object.values.forEach(find)
        }
      }
      for value in playlistValues.values { if let parsed = try? JSONSerialization.jsonObject(with: Data(value.utf8), options: .fragmentsAllowed) { find(parsed) } }
      secrets.accounts = secrets.accounts.filter { accountIDs.contains($0.id) }
      let refs = Set(secrets.accounts.map { $0.secretRef })
      secrets.passwords = secrets.passwords.filter { refs.contains($0.key) }
      secrets.preferences = try PropertyListSerialization.data(fromPropertyList: [:], format: .binary, options: 0)
    }
    let entries = try LXPortableBackup.inventory(roots, cancellation: cancellation)
    let manifest = LXBackupManifest(application: bundle, version: version, build: build, created: Date().timeIntervalSince1970,
      sourceHome: paths.home.path, kind: kind, roots: roots.keys.sorted(), entries: entries, secrets: secrets)
    let name = "LX-Music-\(kind)-\(Int(manifest.created))-\(UUID().uuidString.lowercased()).lxbackup"
    let output = try LXFiles.child(paths.exports, name)
    try LXPortableBackup.create(manifest, roots: roots, password: password, output: output, cancellation: cancellation, progress: progress)
    guard NSDictionary(dictionary: try PropertyListSerialization.propertyList(from: initialPreferences, options: [], format: nil) as! [String: Any])
      .isEqual(to: try PropertyListSerialization.propertyList(from: preferences.read(), options: [], format: nil) as! [String: Any]) else {
      try? LXFiles.fm.removeItem(at: output)
      throw LXLibraryError("备份期间偏好设置发生变化，请重试")
    }
    return (output, manifest)
  }
  private func rebaseFull(_ manifest: LXBackupManifest, root: URL) throws -> LXBackupManifest {
    var manifest = manifest
    let support = root.appendingPathComponent("support", isDirectory: true)
    let storage = try LXStorageSnapshot.storageURL(support: support, bundle: bundle)
    if fileExists(storage) {
      let values = try LXStorageSnapshot.rebase(LXStorageSnapshot.read(storage), oldHome: manifest.sourceHome, newHome: paths.home.path)
      let rebuilt = storage.appendingPathExtension("rebuild")
      try LXStorageSnapshot.write(values, directory: rebuilt)
      try LXFiles.fm.removeItem(at: storage); try LXFiles.fm.moveItem(at: rebuilt, to: storage)
    }
    // Rebase JSON metadata stored outside AsyncStorage (including cache indexes
    // and custom file records). Binary music, IR files and scripts stay intact.
    if let enumerator = LXFiles.fm.enumerator(at: root, includingPropertiesForKeys: [.isRegularFileKey]) {
      for case let file as URL in enumerator {
        guard file.pathExtension.lowercased() == "json", !file.path.hasPrefix(storage.path + "/"),
          ((try? LXFiles.size(file)) ?? Int64.max) <= 16 * 1024 * 1024 else { continue }
        let raw = try Data(contentsOf: file)
        guard let value = try? JSONSerialization.jsonObject(with: raw, options: .fragmentsAllowed) else { continue }
        let rebased = try LXStorageSnapshot.rebaseObject(value, oldHome: manifest.sourceHome, newHome: paths.home.path)
        let next = try JSONSerialization.data(withJSONObject: rebased, options: [.fragmentsAllowed, .sortedKeys])
        let normalized = try JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed, .sortedKeys])
        if next != normalized { try LXFiles.atomic(next, to: file) }
      }
    }
    let preferences = try PropertyListSerialization.propertyList(from: manifest.secrets.preferences, options: [], format: nil)
    manifest.secrets.preferences = try PropertyListSerialization.data(fromPropertyList:
      LXStorageSnapshot.rebaseObject(preferences, oldHome: manifest.sourceHome, newHome: paths.home.path), format: .binary, options: 0)
    // Account configuration and referenced Keychain values must be a pair.
    let restoredConfig = try configuration(support.appendingPathComponent("LXLibraryV1/accounts.json"))
    guard restoredConfig.accounts == manifest.secrets.accounts else { throw LXLibraryError("备份账户配置与凭据索引不一致") }
    return manifest
  }
  func stage(archive: URL, password: String, cancellation: LXDAVCancellation, progress: ((Int64, Int64) -> Void)? = nil) throws -> LXRestoreOutcome {
    guard try read() == nil else { throw LXLibraryError("已有待恢复事务，请先取消或完成") }
    try paths.initialize()
    let id = UUID().uuidString.lowercased()
    let base = try LXFiles.child(paths.transactions, id)
    let staging = base.appendingPathComponent("new", isDirectory: true)
    var keep = false
    defer { if !keep { try? LXFiles.fm.removeItem(at: base) } }
    var manifest = try LXPortableBackup.extract(archive, password: password, staging: staging, application: bundle, build: build,
      cancellation: cancellation, progress: progress)
    var mappings: [LXRestoreMapping] = []; var entries: [LXBackupEntry] = []
    if manifest.kind == "full" {
      manifest = try rebaseFull(manifest, root: staging)
      mappings = manifest.roots.map { LXRestoreMapping(name: $0, live: allowedMappings()[$0]!) }
      let roots = Dictionary(uniqueKeysWithValues: mappings.map { ($0.name, staging.appendingPathComponent($0.name)) })
      entries = try LXPortableBackup.inventory(roots, cancellation: cancellation)
    } else { try LXStorageSnapshot.validatePlaylists(manifest.secrets.playlists ?? [:]) }
    let journal = LXRestoreJournal(id: id, state: "prepared", manifest: manifest, mappings: mappings, stagedEntries: entries)
    try save(journal); keep = true
    return try status()
  }
  func arm(_ id: String) throws -> LXRestoreOutcome {
    guard var journal = try read(), journal.id == id, journal.state == "prepared" else { throw LXLibraryError("待恢复事务已变化") }
    journal.state = "ready"; try save(journal)
    return try status()
  }
  func cancel(_ id: String) throws {
    guard let journal = try read(), journal.id == id, ["prepared", "ready"].contains(journal.state) else { throw LXLibraryError("此恢复事务不能在当前阶段取消") }
    let base = try LXFiles.child(paths.transactions, id)
    // No live root has been touched in prepared/ready states.
    if fileExists(base) { try LXFiles.fm.removeItem(at: base) }
    try LXFiles.fm.removeItem(at: journalFile)
    try LXFiles.write(LXRestoreOutcome(state: "cancelled", message: "已取消恢复，原数据未改动"), to: outcomeFile)
  }
  private func preparePlaylists(_ journal: inout LXRestoreJournal) throws {
    let incoming = try LXStorageSnapshot.rebase(journal.manifest.secrets.playlists ?? [:], oldHome: journal.manifest.sourceHome, newHome: paths.home.path)
    try LXStorageSnapshot.validatePlaylists(incoming)
    let storage = try LXStorageSnapshot.storageURL(support: paths.support, bundle: bundle)
    var values = try LXStorageSnapshot.read(storage).filter { !LXStorageSnapshot.isPlaylist($0.key) }
    values.merge(incoming) { _, new in new }
    let newStorage = try area(journal, "new", "storage")
    // A ready journal has not begun any live changes. Leftovers here can only
    // be this transaction's interrupted preparation; retain rather than erase.
    guard !fileExists(newStorage) else { throw LXLibraryError("歌单恢复准备未完成，请取消后重新选择备份") }
    try LXStorageSnapshot.write(values, directory: newStorage)
    var config = try configuration(paths.config)
    for account in journal.manifest.secrets.accounts {
      config.accounts.removeAll { $0.id == account.id }; config.accounts.append(account)
    }
    try LXFiles.write(config, to: area(journal, "new", "accounts"))
    journal.mappings = [LXRestoreMapping(name: "storage", live: allowedMappings()["storage"]!),
                        LXRestoreMapping(name: "accounts", live: allowedMappings()["accounts"]!)]
    // File mappings are hashed directly; the directory mapping uses inventory.
    var entries = try LXPortableBackup.inventory(["storage": newStorage])
    let file = try area(journal, "new", "accounts")
    entries.append(LXBackupEntry(path: "accounts", directory: false, bytes: try LXFiles.size(file), sha256: try LXFiles.hash(file)))
    journal.stagedEntries = entries
  }
  private func verifyStaged(_ journal: LXRestoreJournal) throws {
    var entries: [LXBackupEntry] = []
    for map in journal.mappings.sorted(by: { $0.name < $1.name }) {
      let url = try area(journal, "new", map.name)
      if map.name == "accounts" { entries.append(LXBackupEntry(path: map.name, directory: false, bytes: try LXFiles.size(url), sha256: try LXFiles.hash(url))) }
      else { entries += try LXPortableBackup.inventory([map.name: url]) }
    }
    guard entries.sorted(by: { $0.path < $1.path }) == journal.stagedEntries.sorted(by: { $0.path < $1.path }) else {
      throw LXLibraryError("恢复暂存文件完整性校验失败，原数据未替换")
    }
  }
  private func rollback(_ journal: LXRestoreJournal) throws {
    for map in journal.mappings.reversed() where map.started {
      let destination = try live(map), old = try area(journal, "old", map.name), staged = try area(journal, "new", map.name)
      if !fileExists(staged), fileExists(destination) {
        try LXFiles.mkdir(staged.deletingLastPathComponent()); try LXFiles.fm.moveItem(at: destination, to: staged)
      }
      if fileExists(old) {
        if fileExists(destination) {
          let recovered = try area(journal, "retained", map.name + "-" + UUID().uuidString.lowercased())
          try LXFiles.mkdir(recovered.deletingLastPathComponent()); try LXFiles.fm.moveItem(at: destination, to: recovered)
        }
        try LXFiles.mkdir(destination.deletingLastPathComponent()); try LXFiles.fm.moveItem(at: old, to: destination)
      } else if map.oldExisted && !fileExists(destination) { throw LXLibraryError("原数据回滚副本缺失，已停止初始化以保护文件") }
    }
    if let original = journal.oldSecrets { try replaceSecrets(original) }
    try LXFiles.write(LXRestoreOutcome(state: "rolledBack", message: "恢复未完成，已回滚原数据", id: journal.id, kind: journal.manifest.kind), to: outcomeFile)
    if fileExists(journalFile) { try LXFiles.fm.removeItem(at: journalFile) }
    // Retain an interrupted transaction's staged copies for manual inspection;
    // they are outside app data and never treated as a successfully restored set.
  }
  func boot() throws -> LXRestoreOutcome {
    guard var journal = try read() else { return try status() }
    if journal.state == "prepared" { return try status() }
    if journal.state == "acknowledged" {
      try LXFiles.write(LXRestoreOutcome(state: "restored", message: "数据恢复及应用初始化已完成", id: journal.id, kind: journal.manifest.kind), to: outcomeFile)
      try cleanup(journal); return try status()
    }
    if ["applying", "awaitingAck"].contains(journal.state) { try rollback(journal); return try status() }
    guard journal.state == "ready" else { throw LXLibraryError("未知恢复状态") }
    do {
      if journal.manifest.kind == "playlists" { try preparePlaylists(&journal) }
      try verifyStaged(journal)
      let old = try captureSecrets(); journal.oldSecrets = old
      var desired = journal.manifest.secrets
      if journal.manifest.kind == "playlists" {
        desired.preferences = old.preferences
        desired.passwords = old.passwords.merging(desired.passwords) { _, incoming in incoming }
      }
      journal.desiredSecrets = desired
      journal.state = "applying"; try save(journal)
      for index in journal.mappings.indices {
        var map = journal.mappings[index]
        let destination = try live(map), old = try area(journal, "old", map.name), staged = try area(journal, "new", map.name)
        map.oldExisted = fileExists(destination); map.started = true
        journal.mappings[index] = map; try save(journal)
        if map.oldExisted {
          try LXFiles.mkdir(old.deletingLastPathComponent()); try LXFiles.fm.moveItem(at: destination, to: old)
        }
        try failpoint?("after-old-" + map.name)
        try LXFiles.mkdir(destination.deletingLastPathComponent()); try LXFiles.fm.moveItem(at: staged, to: destination)
        try failpoint?("after-new-" + map.name)
      }
      try replaceSecrets(desired); try failpoint?("after-secrets")
      journal.state = "awaitingAck"; try save(journal)
      try failpoint?("awaiting-ack")
      return try status()
    } catch {
      // The same in-memory journal includes a move even when the immediately
      // following save failed; on a process crash the on-disk started marker
      // and actual new/old filesystem locations provide the same information.
      try rollback(journal)
      return try status()
    }
  }
  private func cleanup(_ journal: LXRestoreJournal) throws {
    let base = try LXFiles.child(paths.transactions, journal.id)
    if fileExists(base) { try LXFiles.fm.removeItem(at: base) }
    if fileExists(journalFile) { try LXFiles.fm.removeItem(at: journalFile) }
  }
  func acknowledge() throws -> LXRestoreOutcome {
    guard var journal = try read() else { return try status() }
    guard journal.state == "awaitingAck" else { return try status() }
    journal.state = "acknowledged"; try save(journal)
    let outcome = LXRestoreOutcome(state: "restored", message: "数据恢复及应用初始化已完成", id: journal.id, kind: journal.manifest.kind)
    try LXFiles.write(outcome, to: outcomeFile); try cleanup(journal)
    return outcome
  }
}

#if os(iOS)
@objc(LXRestoreBootstrap)
final class LXRestoreBootstrap: NSObject {
  static func coordinator() throws -> LXRestoreCoordinator {
    guard let bundle = Bundle.main.bundleIdentifier, let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String,
      let buildText = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String, let build = Int(buildText) else {
      throw LXLibraryError("应用版本信息不完整")
    }
    return LXRestoreCoordinator(paths: LXLibraryPaths(), bundle: bundle, version: version, build: build,
      vault: LXKeychainVault(service: bundle + ".library.accounts"), journalVault: LXKeychainVault(service: bundle + ".library.restore"),
      preferences: LXAppPreferences(bundle: bundle))
  }
  @objc static func prepare(_ completion: @escaping (NSError?) -> Void) {
    DispatchQueue.global(qos: .userInitiated).async {
      do { _ = try coordinator().boot(); DispatchQueue.main.async { completion(nil) } }
      catch { DispatchQueue.main.async { completion(NSError(domain: "LXRestore", code: 1, userInfo:
        [NSLocalizedDescriptionKey: "恢复事务未能安全完成，原文件已保留。请重新启动应用重试，不要卸载应用。"] )) } }
    }
  }
}
#endif
