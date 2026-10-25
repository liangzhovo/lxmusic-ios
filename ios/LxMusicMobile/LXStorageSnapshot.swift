import Foundation
import CryptoKit

/// Read/rebuild the actual AsyncStorage backend used by this pinned app, not an
/// unrelated song-list export. Large-value files are named by MD5(key), while
/// LX adds its own JSON shard layer above that native storage layer.
enum LXStorageSnapshot {
  static let backend = "RCTAsyncLocalStorage_V1"
  static let arrayPrefix = "@___PART_A___"
  static let oldPrefix = "@___PART___"
  static func storageURL(support: URL, bundle: String) throws -> URL {
    try LXFiles.child(support, bundle + "/" + backend)
  }
  private static func md5(_ key: String) -> String {
    Insecure.MD5.hash(data: Data(key.utf8)).map { String(format: "%02x", $0) }.joined()
  }
  static func read(_ directory: URL) throws -> [String: String] {
    let path = directory.appendingPathComponent("manifest.json")
    if !LXFiles.fm.fileExists(atPath: path.path) { return [:] }
    guard try LXFiles.size(path) <= 128 * 1024 * 1024,
      let manifest = try JSONSerialization.jsonObject(with: Data(contentsOf: path)) as? [String: Any] else {
      throw LXLibraryError("应用数据索引无法读取")
    }
    var raw: [String: String] = [:]; var bytes = 0
    for (key, value) in manifest {
      let text: String
      if let value = value as? String { text = value }
      else if value is NSNull {
        let file = try LXFiles.child(directory, md5(key))
        guard try LXFiles.size(file) <= 128 * 1024 * 1024,
          let value = String(data: try Data(contentsOf: file), encoding: .utf8) else { throw LXLibraryError("应用数据分片损坏") }
        text = value
      } else { throw LXLibraryError("应用数据索引类型不正确") }
      bytes += text.utf8.count
      guard bytes <= 512 * 1024 * 1024 else { throw LXLibraryError("应用元数据超过安全限制") }
      raw[key] = text
    }
    var output = raw; var consumed = Set<String>()
    for (key, value) in raw {
      let keys: [String]
      if value.hasPrefix(arrayPrefix) {
        guard let data = String(value.dropFirst(arrayPrefix.count)).data(using: .utf8),
          let parsed = try JSONSerialization.jsonObject(with: data) as? [String], parsed.count <= 10000 else {
          throw LXLibraryError("应用数据分片索引不正确")
        }
        keys = parsed
      } else if value.hasPrefix(oldPrefix) { keys = String(value.dropFirst(oldPrefix.count)).components(separatedBy: ",") }
      else { continue }
      guard !keys.isEmpty, Set(keys).count == keys.count, !keys.contains(key) else { throw LXLibraryError("应用数据分片循环或重复") }
      var text = ""
      for part in keys {
        guard part.hasPrefix(arrayPrefix) || part.hasPrefix(oldPrefix), let partValue = raw[part] else { throw LXLibraryError("应用数据分片缺失") }
        text += partValue; consumed.insert(part)
        guard text.utf8.count <= 128 * 1024 * 1024 else { throw LXLibraryError("应用单项数据过大") }
      }
      output[key] = text
    }
    for key in consumed { output.removeValue(forKey: key) }
    return output
  }
  static func write(_ values: [String: String], directory: URL) throws {
    // Only called on a new private staging directory before the React bridge
    // starts. Existing live AsyncStorage is never overwritten in place.
    guard !LXFiles.fm.fileExists(atPath: directory.path) else { throw LXLibraryError("恢复存储暂存目录非空") }
    try LXFiles.mkdir(directory)
    var manifest: [String: Any] = [:]
    for (key, value) in values {
      guard key.utf8.count <= 65536, value.utf8.count <= 128 * 1024 * 1024 else { throw LXLibraryError("恢复数据过大") }
      if value.utf8.count <= 1024 { manifest[key] = value }
      else {
        try LXFiles.atomic(Data(value.utf8), to: try LXFiles.child(directory, md5(key)))
        manifest[key] = NSNull()
      }
    }
    try LXFiles.atomic(JSONSerialization.data(withJSONObject: manifest, options: [.sortedKeys]), to: directory.appendingPathComponent("manifest.json"))
  }
  static func isPlaylist(_ key: String) -> Bool {
    key == "@user_list" || key.hasPrefix("@list__") || key == "@list_prev_select_id" || key == "@list_scroll_position"
  }
  static func validatePlaylists(_ values: [String: String]) throws {
    guard values.keys.allSatisfy(isPlaylist), let metadata = values["@user_list"],
      let array = try JSONSerialization.jsonObject(with: Data(metadata.utf8)) as? [[String: Any]], array.count <= 10000 else {
      throw LXLibraryError("歌单备份缺少有效的列表索引")
    }
    var ids = Set<String>(["default", "love", "temp"])
    for value in array {
      guard let id = value["id"] as? String, !id.isEmpty, id.utf8.count <= 4096, let name = value["name"] as? String,
        name.utf8.count <= 8192, ids.insert(id).inserted else { throw LXLibraryError("歌单列表标识重复或无效") }
    }
    for (key, value) in values where key.hasPrefix("@list__") {
      guard let songs = try JSONSerialization.jsonObject(with: Data(value.utf8)) as? [[String: Any]], songs.count <= 1000000,
        songs.allSatisfy({ ($0["id"] as? String)?.isEmpty == false && $0["name"] is String && $0["source"] is String && $0["meta"] is [String: Any] }) else {
        throw LXLibraryError("歌单歌曲记录不正确")
      }
    }
    for id in ids where id != "temp" { guard values["@list__" + id] != nil else { throw LXLibraryError("歌单备份缺少歌曲列表") } }
  }
  static func rebaseObject(_ value: Any, oldHome: String, newHome: String) throws -> Any {
    if let s = value as? String {
      let old = oldHome.hasPrefix("/private/var/") ? String(oldHome.dropFirst(8)) : oldHome
      let aliases = Set([oldHome, old, old.hasPrefix("/var/") ? "/private" + old : old])
      var text = s
      for prefix in aliases.sorted(by: { $0.count > $1.count }) {
        let encoded = URL(fileURLWithPath: prefix).absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let next = URL(fileURLWithPath: newHome).absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        text = text.replacingOccurrences(of: encoded + "/", with: next + "/")
        text = text.replacingOccurrences(of: prefix + "/", with: newHome + "/")
        if text == prefix { text = newHome }
      }
      return text
    }
    if let array = value as? [Any] { return try array.map { try rebaseObject($0, oldHome: oldHome, newHome: newHome) } }
    if let object = value as? [String: Any] {
      var output: [String: Any] = [:]
      for (key, value) in object {
        let nextKey = try rebaseObject(key, oldHome: oldHome, newHome: newHome) as! String
        guard output[nextKey] == nil else { throw LXLibraryError("迁移后的嵌套存储键发生冲突") }
        output[nextKey] = try rebaseObject(value, oldHome: oldHome, newHome: newHome)
      }
      return output
    }
    return value
  }
  static func rebase(_ values: [String: String], oldHome: String, newHome: String) throws -> [String: String] {
    var next: [String: String] = [:]
    for (key, text) in values {
      let newKey = try rebaseObject(key, oldHome: oldHome, newHome: newHome) as! String
      guard next[newKey] == nil else { throw LXLibraryError("迁移后的存储键发生冲突") }
      if let value = try? JSONSerialization.jsonObject(with: Data(text.utf8), options: .fragmentsAllowed) {
        let rebased = try rebaseObject(value, oldHome: oldHome, newHome: newHome)
        let data = try JSONSerialization.data(withJSONObject: rebased, options: [.fragmentsAllowed, .sortedKeys])
        next[newKey] = String(decoding: data, as: UTF8.self)
      } else { next[newKey] = try rebaseObject(text, oldHome: oldHome, newHome: newHome) as? String }
    }
    return next
  }
}
