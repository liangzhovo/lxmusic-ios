import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

@main struct ResumeTests {
  static var count = 0
  static func check(_ value: @autoclosure () throws -> Bool, _ message: String) throws {
    guard try value() else { throw NSError(domain: "ResumeTest", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }
    count += 1; FileHandle.standardOutput.write(Data(("PASS " + message + "\n").utf8))
  }
  static func digest(_ url: URL) throws -> String {
    let p = Process(); let output = Pipe()
    #if os(Linux)
    p.executableURL = URL(fileURLWithPath: "/usr/bin/sha256sum"); p.arguments = [url.path]
    #else
    p.executableURL = URL(fileURLWithPath: "/usr/bin/shasum"); p.arguments = ["-a", "256", url.path]
    #endif
    p.standardOutput = output; try p.run()
    let data = output.fileHandleForReading.readDataToEndOfFile(); p.waitUntilExit()
    guard p.terminationStatus == 0, let value = String(data: data, encoding: .utf8)?.split(separator: " ").first else { throw LXTransferError.response }
    return String(value)
  }
  static func request(_ url: String) -> URLRequest { var r = URLRequest(url: URL(string: url)!); r.setValue("never-forward-credential", forHTTPHeaderField: "Authorization"); return r }
  static func main() async {
    do { try await runTests() } catch { FileHandle.standardError.write(Data(("FAIL: " + String(describing: error) + "\n").utf8)); exit(1) }
  }
  static func runTests() async throws {
    let base = CommandLine.arguments[1]
    let fm = FileManager.default, folder = fm.temporaryDirectory.appendingPathComponent("lx-resume-tests-" + UUID().uuidString)
    try fm.createDirectory(at: folder, withIntermediateDirectories: true); defer { try? fm.removeItem(at: folder) }
    let total: Int64 = 4 * 1024 * 1024, payload = Data(repeating: 65, count: Int(total))
    func url(_ name: String) -> URL { folder.appendingPathComponent(name + ".part") }
    func setup(_ name: String, fingerprint: String = "v1", etag: String = "\"stable\"", corrupt: Bool = false, tail: Bool = false) throws -> URL {
      let f = url(name); try Data(repeating: 65, count: 65536).write(to: f)
      let hash = try digest(f)
      if corrupt { try Data(repeating: 66, count: 65536).write(to: f) }
      if tail { let h = try FileHandle(forWritingTo: f); try h.seekToEnd(); try h.write(contentsOf: Data(repeating: 90, count: 10000)); try h.close() }
      let checkpoint = LXResumeCheckpoint(fingerprint: fingerprint, etag: etag, total: total, verifiedSize: 65536, verifiedSHA256: hash)
      try JSONEncoder().encode(checkpoint).write(to: f.appendingPathExtension("resume.json"))
      return f
    }
    func run(_ endpoint: String, _ file: URL, fingerprint: String = "v1", cancellation: LXDAVCancellation = LXDAVCancellation(), maximum: Int64 = 8 * 1024 * 1024,
             redirects: Bool = false, progress: ((Int64, Int64) -> Void)? = nil) async throws -> LXTransferResult {
      try await LXResumableTransfer(request: request(base + endpoint), file: file, fingerprint: fingerprint, maximum: maximum, cancellation: cancellation,
        publicRedirects: redirects, digest: digest, progress: progress).start()
    }
    let initial = try await run("/file", url("first"))
    try check(initial.resumedFrom == 0 && initial.bytes == total, "complete 200 publishes exact bytes")
    try check(try Data(contentsOf: initial.file) == payload, "independent response byte comparison")
    let prepared = try setup("resume")
    let resumed = try await run("/file", prepared)
    try check(resumed.resumedFrom == 65536 && resumed.bytes == total, "strong ETag, exact Content-Range and local digest resume verified prefix")
    try check(try Data(contentsOf: prepared) == payload, "resumption has no duplicated prefix or missing suffix")
    let corrupt = try await run("/file", setup("corrupt", corrupt: true))
    try check(corrupt.resumedFrom == 0, "same-size local corruption forces fresh request")
    let tail = try await run("/file", setup("tail", tail: true))
    try check(tail.resumedFrom == 65536 && (try Data(contentsOf: tail.file)) == payload, "uncheckpointed crash tail is removed before digest-verified resume")
    let changedURL = try await run("/file", setup("url-change"), fingerprint: "v2")
    try check(changedURL.resumedFrom == 0, "changed URL or account revision never blindly appends")
    let weak = try await run("/file", setup("weak", etag: "W/\"stable\""))
    try check(weak.resumedFrom == 0, "weak validator cannot authorize byte resume")
    let ignored = try await run("/ignore-range", setup("ignored"))
    try check(ignored.resumedFrom == 0 && (try Data(contentsOf: ignored.file)) == payload, "200 after Range truncates old prefix rather than append")
    for endpoint in ["/bad-range", "/changed-tag", "/bad-total"] {
      let file = try setup(endpoint.dropFirst().description)
      do { _ = try await run(endpoint, file); throw NSError(domain: "unexpected success", code: 1) }
      catch LXTransferError.changed { try check(!fm.fileExists(atPath: file.path), "reject and invalidate incorrect range/validator " + endpoint) }
    }
    let cancellation = LXDAVCancellation(), pausedFile = url("paused")
    do {
      _ = try await run("/slow", pausedFile, cancellation: cancellation, progress: { n, _ in if n > 100000 { cancellation.cancel() } })
      throw NSError(domain: "unexpected pause success", code: 1)
    } catch {
      let saved = try JSONDecoder().decode(LXResumeCheckpoint.self, from: Data(contentsOf: pausedFile.appendingPathExtension("resume.json")))
      try check(saved.verifiedSize > 0 && saved.verifiedSize < total && (try digest(pausedFile)) == saved.verifiedSHA256, "pause persists SHA-verified prefix after file synchronization")
      let restarted = try await run("/file", pausedFile)
      try check(restarted.resumedFrom == saved.verifiedSize && (try Data(contentsOf: restarted.file)) == payload, "fresh transfer instance resumes actual cancelled job")
    }
    do { _ = try await run("/file", url("oversize"), maximum: 1000); throw NSError(domain: "unexpected oversize", code: 1) }
    catch LXTransferError.changed { try check(true, "declared oversized response cannot be published") }
    let preCancelled = LXDAVCancellation(); preCancelled.cancel()
    do { _ = try await run("/file", url("pre-cancel"), cancellation: preCancelled); throw NSError(domain: "unexpected cancellation", code: 1) }
    catch LXDALError.cancelled { try check(!fm.fileExists(atPath: url("pre-cancel").path), "cancellation before attachment issues no request or file") }
    do { _ = try await run("/redirect", url("redirect")); throw NSError(domain: "unexpected redirect", code: 1) }
    catch LXTransferError.unsafeRedirect { try check(true, "DAV redirection is rejected without forwarding Authorization") }
    let redirected = try await run("/redirect", url("public"), redirects: true)
    try check(redirected.bytes == total, "public media redirects work after credentials are stripped")
    do { _ = try await run("/truncated", url("truncated")); throw NSError(domain: "unexpected truncation", code: 1) }
    catch { try check((try? Data(contentsOf: url("truncated")).count) != Int(total), "truncated HTTP transfer remains failure, not completed file") }
    print("\(count) resumable transfer assertions passed against a real HTTP server; not native App acceptance.")
  }
}
