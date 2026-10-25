# Build88 — combined feature batch; native acceptance pending

Repository: `skyhc/lx-music-mobile`, target `master`.
Batch parent: `d2f36ee2bb6e2785dcc9e57dba5e8ec8f985dfcf`.
Package intent: `1.9.0 / 88`; never replace the published Build87.

## Verified parent

Full iOS #95 / run `35167632349` and incremental `35167632362` succeeded on d2f36ee. That parent already included the dark playback bar, stable-ID My Lists locator, and CD/square cover selection. Its original native playback, DSP/FLAC, offline, theme/restart, sync, full-history checks, 54 screenshots, device archive and IPA passed. It was still package 1.9.0/87. The successful rerun does not establish the original #94 transient sync failure's root cause; d2 preserves diagnostics and verifies the fixture's actual protocol readiness.

## User-requested single combined implementation

All remaining production paths are connected in this batch **before** starting the next complete iOS build. There is no per-feature Xcode submission. Local checks below do not mean Apple SDK, simulator, device archive or Release acceptance has occurred.

| Requirement | Production implementation | Required evidence |
| --- | --- | --- |
| Dark bottom dock; My Lists locate; CD/square | Preserve already committed production paths. Full-player queue remains unchanged. | Existing dock/My Lists/cover tests, original 54 native screenshots and new cover screenshots. |
| WebDAV accounts and playlists | `LXLibraryServices` bridge and `LXLibraryWorker` actor; real Keychain accounts; HTTPS by default, explicit HTTP opt-in; actual PROPFIND directory UI, selection/import into normal My Lists; opaque credential-free music references. | Native HTTP core checks, real facade/UI tests, simulator account authentication, Unicode directory import and actual player timeline. |
| Separate cache/traffic control | Five-minute bounded directory cache; independent verified audio cache with quota/LRU, protected playback leases and manual clear. Turning audio cache off re-fetches a complete temporary file; playback starts after preparation using the existing native player. No password or authenticated server URL is handed to TrackPlayer. | Independent server request counters, cache-on/off checks, MP3/FLAC replay, cold offline restart with fixture service stopped. |
| Default-disabled downloads | Durable one-at-a-time queue, real existing-source URL resolution per attempt, selectable quality, pause/retry, conservative pause after app background/restart. Native strong-ETag/If-Range + locally hashed prefix enables verified resume; otherwise restart safely. Local file receipts and DAV staging/readback/Overwrite:F MOVE protect completed destinations. | 20 queue/storage groups; native real HTTP resume checks; simulator paused native transfer, server-observed 206, SHA-equal local/DAV outputs. |
| Complete encrypted backup/restore | Password-derived PBKDF2-HMAC-SHA256 (600000 rounds) and chunked AES-256-GCM with authenticated manifest, ordered records and final marker. Full: Documents, Application Support, own app preferences/Keychain and optional Caches. Includes user sources, lists, settings, downloads and queue state. Playlist-only preserves unrelated current state. File/path/version/size/hash validation and cold pre-React-bridge journaled replacement with rollback until initialization acknowledgement. | Actual Apple CryptoKit/CommonCrypto test executable, independent PBKDF2 vector, corruption/password rejection, process-death rollback and post-credential failure rollback; actual simulator full/playlist restores across cold restarts. |
| Final Release policy | `ios_release_policy.py` verifies same-source reports, original 54 and new five images, native tests, full App phases, source snapshot, app identity/Mach-O/ZIP CRC/SHA and byte-identical IPA/archive application. Only new Build88 is published from the same validated master build. | Fail-closed synthetic policy tests plus real full Actions reports and binary packages; GitHub read-back of exactly three custom assets. |

## Explicit data and transport boundaries

Backup files themselves (`Library/LXBackupExports`), pending restore journals, transient playback copies, operating-system permissions, signing identities and files outside the app that were never imported are not application backup contents. Credentials in portable backups are encrypted with the user's passphrase. This app's own WebDAV Keychain service is the only vault enumerated; system or unrelated services are not read. Device-only after-first-unlock protection permits legitimate background audio access. Production network errors do not return request URLs, headers or passwords.

WebDAV PUT is not presented as universally resumable: retries reuse the fully verified local download, then retry an owned staging upload, full read-back SHA verification and no-overwrite MOVE. This verification consumes an extra remote read. Playback preparation downloads a complete supported audio file; the UI does not claim progressive streaming. Download execution is foreground-controlled; app background/restart pauses jobs and requires explicit continuation.

Restore stages without replacing live data. On the next cold start, before RCTBridge/AsyncStorage opens, the transaction retains original roots and credentials. A failed or unacknowledged initialization rolls back on the next cold start. Temporary interrupted transaction copies are retained, not silently deleted or labelled a successful restore. A playlist backup is never reported as full application data.

## Cross-checks before the batch submission

Round one used the actual d2 source ZIP commit marker, CRC/SHA, the pinned upstreams and the earlier checkpoint's pre/postimages. It traced directory/account controls to registered native commands, imported songs through the actual resource loader, downloads from existing music/list menus, and backup/restore through the live storage/list serialization barriers. It found and repaired directory-cancellation/credential-edit sequencing and restored-file protection for locked/background playback.

Round two checked the full original requirement matrix and preservation boundaries. Original README, full player playlist, cache engine, Info.plist, native audio/DSP/FLAC/auth blocks and signature identity remain unchanged. The sole AppDelegate extension is explicitly accounted for by `native-build88-patch.json`: strip those exact five reviewed insertions/replacements and its entire historical SHA256 must still match. Existing history/type/settings/upstream assertions remain mandatory in CI; version expectations advance to the real new Build88 rather than being removed.

Local executable checks: queue/storage, facade/UI wiring and credential cancellation, original standalone regressions, native Foundation WebDAV/HTTP and resume behavior, fail-closed release-policy fixtures, full-project TypeScript, and a production iOS JavaScript bundle. The local bundle resolver only adapts the out-of-tree extracted node_modules layout; that adapter is not shipped or used in Actions. Apple-only crypto/native type-checks, actual new App acceptance, all-history comparisons, native screenshots, Xcode archive and final publication are still **pending the batch Actions run**.

## Mandatory completion gates

The main workflow retains the original full suite and timeout, adds Apple native library checks and a separate real App library run, and only then builds the device archive. It embeds `LX-BUILD.json` in the unsigned app before making the IPA so both packages carry the same source/run marker. Publication rechecks master/tag/source identities and requires old and new acceptance reports plus binary consistency; no logs, screenshots, metadata JSON or source snapshots become Release assets.

Do not report overall completion or disable tracking merely because this code batch exists, an incremental check passes, or an older build succeeds. Required final evidence: the batch's actual Apple SDK and simulator gates, the original 54-image/full-history gates, successful device Xcode archive, matching Build88 IPA/xcarchive source/identity/version/CRC/SHA, and a publicly verified new Build88 Release. Simulator validation is not physical-device acceptance.
