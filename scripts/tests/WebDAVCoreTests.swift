import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

@main struct Tests {
  static var checks = 0
  static func check(_ name: String, _ condition: @autoclosure () throws -> Bool) throws {
    guard try condition() else { throw NSError(domain: "TEST", code: 1, userInfo: [NSLocalizedDescriptionKey: name]) }
    checks += 1; print("PASS \(name)")
  }
  static func rejects(_ name: String, _ block: () throws -> Void) throws {
    do { try block() } catch { checks += 1; print("PASS \(name)"); return }
    throw NSError(domain: "TEST", code: 2, userInfo: [NSLocalizedDescriptionKey: "Expected rejection: \(name)"])
  }
  static func rejectsAsync(_ name: String, _ block: () async throws -> Void) async throws {
    do { try await block() } catch { checks += 1; print("PASS \(name)"); return }
    throw NSError(domain: "TEST", code: 2, userInfo: [NSLocalizedDescriptionKey: "Expected rejection: \(name)"])
  }
  static func xml(_ inner: String) -> Data { Data(("<?xml version=\"1.0\"?><d:multistatus xmlns:d=\"DAV:\">" + inner + "</d:multistatus>").utf8) }
  static func row(_ href: String, _ good: String = "<d:getcontentlength>32</d:getcontentlength>") -> String {
    "<d:response><d:href>\(href)</d:href><d:propstat><d:prop>\(good)</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>"
  }
  static func main() async throws {
    let root = try LXDAVRoot("https://example.test/dav/")
    try check("canonical root", root.url.absoluteString == "https://example.test/dav/")
    try check("space unicode percent hash ampersand encoded exactly once",
      try root.resource("音乐/100% #&+.flac").absoluteString == "https://example.test/dav/%E9%9F%B3%E4%B9%90/100%25%20%23%26%2B.flac")
    for input in ["http://example.test/dav", "https://u:p@example.test/dav", "https://example.test/dav?token=x", "https://example.test/dav#x", "file:///dav", "https://example.test:0/dav", "https://example.test/dav/%2e%2e/", "https://example.test/dav//a"] {
      try rejects("endpoint rejects \(input)") { _ = try LXDAVRoot(input) }
    }
    for path in ["../outside", "x/../../outside", "a\\b", "a//b", "//evil", "a/./b", "a\nAuthorization: x"] {
      try rejects("root-relative path rejects traversal/control \(path.debugDescription)") { _ = try root.resource(path) }
    }
    try check("root path empty accepted", try root.resource("", directory: true).absoluteString == root.url.absoluteString)
    let data = xml(row("/dav/music/", "<d:resourcetype><d:collection/></d:resourcetype>") + row("/dav/music/%E9%9F%B3%E4%B9%90%20%23%25.mp3", "<d:getetag>&quot;v1&quot;</d:getetag><d:getcontentlength>32</d:getcontentlength><d:resourcetype/>") + row("/dav/music/folder/", "<d:resourcetype><d:collection/></d:resourcetype>"))
    let entries = try LXDAVClient.parseListing(data, root: root, requested: "music")
    try check("exclude self and folder first", entries.count == 2 && entries[0].directory)
    try check("decode names and ETag XML entities", entries[1].path == "music/音乐 #%.mp3" && entries[1].etag == "\"v1\"")
    let mixed = "<d:response><d:href>/dav/music/a.mp3</d:href><d:propstat><d:prop><d:getcontentlength>99</d:getcontentlength></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat><d:propstat><d:prop><d:getcontentlength>0</d:getcontentlength><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 404 Not Found</d:status></d:propstat></d:response>"
    let mixedEntry = try LXDAVClient.parseListing(xml(mixed), root: root, requested: "music")
    try check("failed propstat cannot replace valid properties", mixedEntry.count == 1 && mixedEntry[0].size == 99 && !mixedEntry[0].directory)
    for href in ["https://evil.test/dav/music/a.mp3", "/dav-other/music/a.mp3", "/dav/music/%2e%2e/a.mp3", "/dav/music/a%2fb.mp3", "/dav/music/a%5cb.mp3", "/dav/music/a.mp3?token=x", "//evil.test/dav/music/a.mp3", "/dav/music/sub/a.mp3"] {
      try rejects("reject malicious/unexpected href \(href)") { _ = try LXDAVClient.parseListing(xml(row(href)), root: root, requested: "music") }
    }
    try rejects("DTD external entities disabled") { _ = try LXDAVClient.parseListing(Data("<!DOCTYPE d [<!ENTITY x SYSTEM 'file:///etc/passwd'>]><d:multistatus xmlns:d='DAV:'/>".utf8), root: root, requested: "") }
    try rejects("wrong namespace root rejected") { _ = try LXDAVClient.parseListing(Data("<multistatus xmlns='evil'><response/></multistatus>".utf8), root: root, requested: "") }
    try rejects("malformed XML rejected") { _ = try LXDAVClient.parseListing(Data("<d:multistatus xmlns:d='DAV:'>".utf8), root: root, requested: "") }
    try rejects("oversized response rejected") { _ = try LXDAVClient.parseListing(Data(repeating: 32, count: 8 * 1024 * 1024 + 1), root: root, requested: "") }
    try rejects("basic username colon rejected") { _ = try LXDAVClient(root: root, username: "a:b", password: "x") }
    try check("duplicate entries removed", try LXDAVClient.parseListing(xml(row("/dav/music/a.mp3") + row("/dav/music/a.mp3")), root: root, requested: "music").count == 1)

    let args = CommandLine.arguments
    if args.count > 1 {
      let live = try LXDAVRoot(args[1], allowHTTP: true)
      let client = try LXDAVClient(root: live, username: "test-user", password: "test-only-not-a-real-secret")
      let temp = FileManager.default.temporaryDirectory.appendingPathComponent("lx-dav-test-" + UUID().uuidString)
      try FileManager.default.createDirectory(at: temp, withIntermediateDirectories: true)
      defer { try? FileManager.default.removeItem(at: temp) }
      let listing = try await client.list("music")
      try check("HTTP PROPFIND UTF-8 and Depth 1", listing.contains { $0.name == "song #%.mp3" })
      let file = try await client.download("music/song #%.mp3", to: temp.appendingPathComponent("download.mp3"), maxBytes: 1_000_000)
      try check("authenticated real file GET", try Data(contentsOf: file) == Data(repeating: 65, count: 120000))
      let headers = try await client.stat("music/song #%.mp3")
      try check("HEAD accepts large Content-Length without downloading body", headers["content-length"] == "120000")
      let source = temp.appendingPathComponent("upload.flac")
      try Data(repeating: 66, count: 150000).write(to: source)
      try await client.upload(source, to: "music/upload #%.flac")
      let saved = try await client.download("music/upload #%.flac", to: temp.appendingPathComponent("roundtrip.flac"), maxBytes: 200000)
      try check("PUT HEAD MOVE roundtrip preserves bytes", try Data(contentsOf: saved) == Data(contentsOf: source))
      try await rejectsAsync("existing remote file never overwritten") { try await client.upload(file, to: "music/upload #%.flac") }
      let unchanged = try await client.download("music/upload #%.flac", to: temp.appendingPathComponent("unchanged.flac"), maxBytes: 200000)
      try check("conflict leaves old remote file intact", try Data(contentsOf: unchanged) == Data(contentsOf: source))
      try await rejectsAsync("404 does not make a playable file") { _ = try await client.download("missing.mp3", to: temp.appendingPathComponent("missing.mp3"), maxBytes: 1000) }
      try check("no file for failed download", !FileManager.default.fileExists(atPath: temp.appendingPathComponent("missing.mp3").path))
      try await rejectsAsync("oversized download cancelled") { _ = try await client.download("music/song #%.mp3", to: temp.appendingPathComponent("oversize.mp3"), maxBytes: 500) }
      try check("no oversized output", !FileManager.default.fileExists(atPath: temp.appendingPathComponent("oversize.mp3").path))
      try await rejectsAsync("redirect never forwards DAV authorization") { _ = try await client.download("redirect", to: temp.appendingPathComponent("redirect"), maxBytes: 1000) }
      let cancellation = LXDAVCancellation(); cancellation.cancel()
      try await rejectsAsync("cancelled before network starts") { _ = try await client.download("music/song #%.mp3", to: temp.appendingPathComponent("cancelled"), maxBytes: 200000, cancellation: cancellation) }
      let wrong = try LXDAVClient(root: live, username: "wrong", password: "wrong")
      try await rejectsAsync("401 is a failure, not an empty directory") { _ = try await wrong.list("music") }
      try await rejectsAsync("existing local file never overwritten") { _ = try await client.download("music/song #%.mp3", to: source, maxBytes: 200000) }
      try check("local conflict preserves original bytes", try Data(contentsOf: source) == Data(repeating: 66, count: 150000))
    }
    print("WebDAV core: \(checks) assertions passed. Foundation tests only; not an iOS build.")
  }
}
