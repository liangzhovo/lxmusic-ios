import Foundation
import CryptoKit

private final class FileVault: LXSecretVault {
  let file: URL
  init(_ file: URL) { self.file = file }
  func all() throws -> [String: Data] { FileManager.default.fileExists(atPath: file.path) ? try LXFiles.read([String: Data].self, from: file) : [:] }
  func read(_ key: String) throws -> Data? { try all()[key] }
  func write(_ key: String, value: Data?) throws { var data = try all(); data[key] = value; try LXFiles.write(data, to: file) }
}
private final class TestPreferences: LXPreferenceStore {
  let file: URL
  init(_ file: URL) { self.file = file }
  func read() throws -> Data {
    if FileManager.default.fileExists(atPath: file.path) { return try Data(contentsOf: file) }
    return try PropertyListSerialization.data(fromPropertyList: [:], format: .binary, options: 0)
  }
  func write(_ data: Data) throws { try LXFiles.atomic(data, to: file) }
  func set(_ values: [String: Any]) throws { try write(PropertyListSerialization.data(fromPropertyList: values, format: .binary, options: 0)) }
  func object() throws -> [String: Any] { try PropertyListSerialization.propertyList(from: read(), options: [], format: nil) as! [String: Any] }
}
private struct Environment {
  let root: URL, paths: LXLibraryPaths, vault: FileVault, journal: FileVault, prefs: TestPreferences
  init(_ root: URL) throws {
    self.root = root; paths = LXLibraryPaths(home: root.appendingPathComponent("home")); try paths.initialize()
    vault = FileVault(root.appendingPathComponent("test-own-vault.json")); journal = FileVault(root.appendingPathComponent("test-journal-key.json")); prefs = TestPreferences(root.appendingPathComponent("test-prefs.plist"))
  }
  func coordinator(_ failure: ((String) throws -> Void)? = nil) -> LXRestoreCoordinator { LXRestoreCoordinator(paths: paths, bundle: "com.skyhc.lxmusic", version: "1.9.0", build: 88, vault: vault, journalVault: journal, preferences: prefs, failpoint: failure) }
}
@main struct PortableTests {
  static var count = 0
  static let password = "local-test-password-88"
  static func check(_ condition: @autoclosure () throws -> Bool, _ name: String) throws {
    guard try condition() else { throw LXLibraryError("TEST FAILED: " + name) }; count += 1
    FileHandle.standardOutput.write(Data(("PASS " + name + "\n").utf8))
  }
  static func rejected(_ name: String, _ task: () throws -> Void) throws {
    var failed = false; do { try task() } catch { failed = true }
    try check(failed, name)
  }
  static func main() async {
    do {
      if CommandLine.arguments.count > 2 && CommandLine.arguments[1] == "--crash" {
        let env = try Environment(URL(fileURLWithPath: CommandLine.arguments[2]))
        _ = try env.coordinator({ step in if step == "after-old-documents" { exit(77) } }).boot()
        exit(78)
      }
      try await tests()
    } catch { FileHandle.standardError.write(Data(("FAIL " + String(describing: error) + "\n").utf8)); exit(1) }
  }
  static func tests() async throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("lx-portable-tests-" + UUID().uuidString)
    try LXFiles.mkdir(root); defer { try? FileManager.default.removeItem(at: root) }
    let a = try Environment(root.appendingPathComponent("A")), b = try Environment(root.appendingPathComponent("B"))
    // Prime Foundation URL metadata with a verified resume prefix, then grow the
    // same path as LXResumableTransfer does. LXFiles.size must read the live file
    // length rather than a stale URL resource-value cache entry.
    let growing = root.appendingPathComponent("resume-growing.part")
    let prefixBytes = 196608, finalBytes = 8629708
    try Data(repeating: 0x41, count: prefixBytes).write(to: growing)
    _ = try LXFiles.hash(growing)
    let growHandle = try FileHandle(forWritingTo: growing)
    try growHandle.seekToEnd(); try growHandle.write(contentsOf: Data(repeating: 0x42, count: finalBytes - prefixBytes)); try growHandle.close()
    let growingHash = try LXFiles.hash(growing)
    try check(try LXFiles.size(growing) == Int64(finalBytes) && LXFiles.verified(growing, size: Int64(finalBytes), hash: growingHash), "live file size and SHA verification observe resumed file growth after URL metadata is primed")
    let growingLink = root.appendingPathComponent("resume-growing-link.part")
    try FileManager.default.createSymbolicLink(at: growingLink, withDestinationURL: growing)
    try rejected("live size lookup still rejects symbolic links") { _ = try LXFiles.size(growingLink) }
    let metadata: [String: String] = [
      "@user_list": "[{\"id\":\"personal\",\"name\":\"Personal\"}]", "@list__default": "[]", "@list__love": "[]",
      "@list__personal": "[{\"id\":\"webdav:dav:音频/song.mp3\",\"name\":\"track\",\"source\":\"local\",\"meta\":{\"library\":{\"kind\":\"webdav\",\"accountId\":\"dav\",\"path\":\"音频/song.mp3\"},\"filePath\":\"\(a.paths.documents.path)/own.mp3\"}}]",
      "@setting_v1": "{\"theme\":\"dark\",\"volume\":0.73}", "@user_api__fixture": String(repeating: "x", count: 700000),
      "@sync_auth_key": "\"test-only-auth-key\"",
      "@portable_path": "\"\(a.paths.documents.path)/own.mp3\"",
    ]
    let storageA = try LXStorageSnapshot.storageURL(support: a.paths.support, bundle: "com.skyhc.lxmusic")
    try LXStorageSnapshot.write(metadata, directory: storageA)
    try LXFiles.atomic(Data("real-user-file".utf8), to: a.paths.documents.appendingPathComponent("用户文件.txt"))
    try LXFiles.atomic(Data(repeating: 23, count: 2200000), to: a.paths.documents.appendingPathComponent("own.mp3"))
    try LXFiles.atomic(Data("ir-preset".utf8), to: a.paths.support.appendingPathComponent("impulse.wav"))
    try LXFiles.atomic(Data("cached".utf8), to: a.paths.caches.appendingPathComponent("cache.data"))
    let account = LXLibraryAccount(id: "dav", name: "WebDAV", endpoint: "https://dav.invalid/root/", username: "test", allowHTTP: false, directoryCache: true, audioCache: true, revision: "revision", secretRef: "secret-a")
    try LXFiles.write(LXLibraryConfig(accounts: [account], audioLimitMB: 512), to: a.paths.config)
    try a.vault.write("secret-a", value: Data("never-plaintext-credential".utf8)); try a.prefs.set(["gain": 0.8, "file": a.paths.documents.appendingPathComponent("own.mp3").path])
    let key = try LXPortableBackup.key(password: password, salt: Data(repeating: 7, count: 32))
    let hex = key.withUnsafeBytes { Data($0).map { String(format: "%02x", $0) }.joined() }
    try check(hex == CommandLine.arguments[1], "Apple CommonCrypto PBKDF2 matches independent Python hashlib vector")
    try rejected("short passwords rejected") { _ = try LXPortableBackup.key(password: "short", salt: Data(repeating: 7, count: 32)) }
    try check(try LXStorageSnapshot.read(storageA) == metadata, "actual AsyncStorage large-file backend roundtrip")
    let (archive, manifest) = try a.coordinator().createBackup(kind: "full", password: password, includeCaches: true, cancellation: LXDAVCancellation())
    let raw = try Data(contentsOf: archive)
    try check(!raw.contains(Data("never-plaintext-credential".utf8)) && !raw.contains(Data("real-user-file".utf8)) && !raw.contains(Data(password.utf8)), "backup contains no plaintext account credential, user data or encryption passphrase")
    try check(manifest.entries.contains { $0.path == "documents/用户文件.txt" } && manifest.roots == ["caches", "documents", "support"], "full backup inventories actual files and all requested roots")
    try check(!manifest.entries.contains { $0.path.contains("LXBackupExports") || $0.path.contains("LXRestoreTransaction") }, "backups and transaction journals cannot recursively include themselves")
    try rejected("wrong password never stages live replacement") { _ = try b.coordinator().stage(archive: archive, password: "wrong-password-88", cancellation: LXDAVCancellation()) }
    try check(try b.coordinator().status().state == "none", "failed password leaves no armed transaction")
    for (label, data) in [("truncated", Data(raw.dropLast(1))), ("trailing", raw + Data([1]))] {
      let f = root.appendingPathComponent(label + ".lxbackup"); try data.write(to: f)
      try rejected("reject " + label + " authenticated backup") { _ = try b.coordinator().stage(archive: f, password: password, cancellation: LXDAVCancellation()) }
    }
    var corrupted = raw; corrupted[corrupted.count / 2] ^= 1
    let corruptFile = root.appendingPathComponent("corrupt.lxbackup"); try corrupted.write(to: corruptFile)
    try rejected("ciphertext bit change is authenticated and rejected") { _ = try b.coordinator().stage(archive: corruptFile, password: password, cancellation: LXDAVCancellation()) }
    var wrongManifest = manifest; wrongManifest.application = "other.application"
    try rejected("different application identifier rejected before file replacement") { _ = try LXPortableBackup.validate(wrongManifest, application: "com.skyhc.lxmusic", build: 88) }
    wrongManifest = manifest; wrongManifest.minimumBuild = 89
    try rejected("future backup format/build rejected") { _ = try LXPortableBackup.validate(wrongManifest, application: "com.skyhc.lxmusic", build: 88) }
    for dangerous in ["documents/../outside", "/documents/file", "documents/a\\b"] {
      wrongManifest = manifest; wrongManifest.entries.append(LXBackupEntry(path: dangerous, directory: false, bytes: 1, sha256: String(repeating: "a", count: 64)))
      try rejected("unsafe archive path " + dangerous) { _ = try LXPortableBackup.validate(wrongManifest, application: "com.skyhc.lxmusic", build: 88) }
    }
    wrongManifest = manifest; wrongManifest.entries.append(manifest.entries[0])
    try rejected("duplicate archive entry rejected") { _ = try LXPortableBackup.validate(wrongManifest, application: "com.skyhc.lxmusic", build: 88) }
    wrongManifest = manifest; wrongManifest.entries.removeAll { $0.path == "documents" }
    try rejected("missing full data root rejected before restore") { _ = try LXPortableBackup.validate(wrongManifest, application: "com.skyhc.lxmusic", build: 88) }
    wrongManifest.entries.append(LXBackupEntry(path: "documents", directory: false, bytes: 0, sha256: String(repeating: "a", count: 64)))
    try rejected("file cannot replace a full application directory root") { _ = try LXPortableBackup.validate(wrongManifest, application: "com.skyhc.lxmusic", build: 88) }
    try LXFiles.atomic(Data("B-original".utf8), to: b.paths.documents.appendingPathComponent("sentinel.txt")); try b.prefs.set(["old": true]); try b.vault.write("old-key", value: Data("old-secret".utf8))
    let ready = try b.coordinator().stage(archive: archive, password: password, cancellation: LXDAVCancellation())
    try check(ready.state == "prepared" && FileManager.default.fileExists(atPath: b.paths.documents.appendingPathComponent("sentinel.txt").path), "stage performs no live data replacement")
    try rejected("wrong staged transaction id cannot arm restore") { _ = try b.coordinator().arm("wrong") }
    _ = try b.coordinator().arm(ready.id!); let applied = try b.coordinator().boot()
    try check(applied.state == "awaitingAck", "cold restore retains rollback roots pending app initialization")
    try check(try Data(contentsOf: b.paths.documents.appendingPathComponent("用户文件.txt")) == Data("real-user-file".utf8), "real user documents restored")
    try check(try LXFiles.hash(b.paths.documents.appendingPathComponent("own.mp3")) == LXFiles.hash(a.paths.documents.appendingPathComponent("own.mp3")), "multi-chunk encrypted file restores exact SHA256")
    let restoredStorage = try LXStorageSnapshot.read(LXStorageSnapshot.storageURL(support: b.paths.support, bundle: "com.skyhc.lxmusic"))
    // AsyncStorage values are JSON text. Foundation may escape slashes; compare
    // the decoded path exactly rather than searching its serialized spelling.
    let portablePath = try JSONSerialization.jsonObject(with: Data(restoredStorage["@portable_path"]!.utf8), options: .fragmentsAllowed) as? String
    try check(portablePath == b.paths.documents.appendingPathComponent("own.mp3").path, "sandbox-specific file paths rebase to new container")
    let restoredSongs = try JSONSerialization.jsonObject(with: Data(restoredStorage["@list__personal"]!.utf8)) as! [[String: Any]]
    let restoredMeta = restoredSongs[0]["meta"] as! [String: Any]
    try check(restoredMeta["filePath"] as? String == b.paths.documents.appendingPathComponent("own.mp3").path, "nested playlist paths rebase to the exact destination")
    try check(try b.prefs.object()["file"] as? String == b.paths.documents.appendingPathComponent("own.mp3").path, "native preference paths rebase to the exact destination")
    try check(restoredStorage["@user_api__fixture"] == metadata["@user_api__fixture"] && restoredStorage["@sync_auth_key"] == metadata["@sync_auth_key"], "user source data and stored sync credentials survive full backup")
    try check(try b.vault.read("secret-a") == Data("never-plaintext-credential".utf8) && b.vault.read("old-key") == nil, "own WebDAV Keychain values restored alongside matching config")
    try check(try b.prefs.object()["gain"] as? Double == 0.8, "native application preferences restored")
    _ = try b.coordinator().acknowledge(); try check(try b.coordinator().status().state == "restored", "successful initialization acknowledgement commits transaction")
    // A second restore intentionally omits ack; another cold launch must rollback.
    try LXFiles.atomic(Data("current-before-unacked".utf8), to: b.paths.documents.appendingPathComponent("sentinel.txt"))
    let again = try b.coordinator().stage(archive: archive, password: password, cancellation: LXDAVCancellation()); _ = try b.coordinator().arm(again.id!)
    _ = try b.coordinator().boot(); _ = try b.coordinator().boot()
    try check(try b.coordinator().status().state == "rolledBack" && Data(contentsOf: b.paths.documents.appendingPathComponent("sentinel.txt")) == Data("current-before-unacked".utf8), "unacknowledged app startup rolls back on next cold start")
    let cancel = try b.coordinator().stage(archive: archive, password: password, cancellation: LXDAVCancellation()); try b.coordinator().cancel(cancel.id!)
    try check(try Data(contentsOf: b.paths.documents.appendingPathComponent("sentinel.txt")) == Data("current-before-unacked".utf8), "cancelling staged restore leaves current files intact")
    // True process interruption after an original root is renamed.
    let crash = try b.coordinator().stage(archive: archive, password: password, cancellation: LXDAVCancellation()); _ = try b.coordinator().arm(crash.id!)
    let child = Process(); child.executableURL = URL(fileURLWithPath: CommandLine.arguments[0]); child.arguments = ["--crash", b.root.path]
    try child.run(); child.waitUntilExit(); try check(child.terminationStatus == 77, "injected process interruption occurs after real original-root rename")
    _ = try b.coordinator().boot()
    try check(try Data(contentsOf: b.paths.documents.appendingPathComponent("sentinel.txt")) == Data("current-before-unacked".utf8), "durable encrypted journal recovers original files after process death")
    let secretsFailure = try b.coordinator().stage(archive: archive, password: password, cancellation: LXDAVCancellation()); _ = try b.coordinator().arm(secretsFailure.id!)
    let savedVault = try b.vault.all(), savedPrefs = try b.prefs.read()
    _ = try b.coordinator({ step in if step == "after-secrets" { throw LXLibraryError("injected post-secret failure") } }).boot()
    try check(try b.vault.all() == savedVault && b.prefs.read() == savedPrefs, "failure after credential replacement restores the original own vault and preferences")
    try check(try Data(contentsOf: b.paths.documents.appendingPathComponent("sentinel.txt")) == Data("current-before-unacked".utf8), "post-credential failure also rolls back original user files")
    // Playlist-only restore must preserve current non-playlist keys and files.
    let (playlistArchive, playlistManifest) = try a.coordinator().createBackup(kind: "playlists", password: password, includeCaches: false, cancellation: LXDAVCancellation())
    try check(playlistManifest.entries.isEmpty && playlistManifest.secrets.accounts.map { $0.id } == ["dav"], "playlist export carries only referenced accounts, not entire app files")
    let storageB = try LXStorageSnapshot.storageURL(support: b.paths.support, bundle: "com.skyhc.lxmusic")
    var newer = try LXStorageSnapshot.read(storageB); newer["@setting_v1"] = "{\"theme\":\"newer\"}"; newer["@list__personal"] = "[]"
    let newDirectory = b.root.appendingPathComponent("new-storage"); try LXStorageSnapshot.write(newer, directory: newDirectory)
    try FileManager.default.removeItem(at: storageB); try FileManager.default.moveItem(at: newDirectory, to: storageB)
    let listStage = try b.coordinator().stage(archive: playlistArchive, password: password, cancellation: LXDAVCancellation()); _ = try b.coordinator().arm(listStage.id!)
    _ = try b.coordinator().boot()
    let only = try LXStorageSnapshot.read(storageB)
    try check(only["@setting_v1"] == newer["@setting_v1"] && only["@list__personal"]!.contains("track"), "playlist restore replaces songs but retains unrelated latest settings")
    try check(try Data(contentsOf: b.paths.documents.appendingPathComponent("sentinel.txt")) == Data("current-before-unacked".utf8), "playlist restore never replaces user documents")
    _ = try b.coordinator().acknowledge()
    // Simulate LX's actual higher-level sharding in the native backend.
    let sharded = root.appendingPathComponent("shards"), text = "\"" + String(repeating: "z", count: 600001) + "\""
    let keys = ["@___PART_A___large0", "@___PART_A___large1"]
    try LXStorageSnapshot.write(["large": "@___PART_A___[\"\(keys[0])\",\"\(keys[1])\"]", keys[0]: String(text.prefix(500000)), keys[1]: String(text.dropFirst(500000))], directory: sharded)
    try check(try LXStorageSnapshot.read(sharded) == ["large": text], "application shard layer is rebuilt without losing long custom-source metadata")
    // Cancellation check reaches production encryption path before file creation.
    let cancelled = LXDAVCancellation(); cancelled.cancel()
    try rejected("cancelled backup does not produce a complete archive") { _ = try a.coordinator().createBackup(kind: "full", password: password, includeCaches: true, cancellation: cancelled) }
    print("\(count) Apple SDK encrypted-backup/restore assertions passed; physical devices are not exercised.")
  }
}
