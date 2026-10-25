# Build88: inspect the lost App process, then close out

Current parent: `3b32981498572991cbe30219deb9f4455e15daa0`.

The exact source and evidence archives from run #103 were recovered and CRC/SHA checked. Its source tree matches `b3230d4e43611283bc1189600d792ac7cbb2a1e1`. The subsequent two-file fast-failure ordering change was replayed and independently matches parent tree `360bd1f68238225a6431b91917832724a52f39cc`.

#103 is not the same observed result as #102: it has six successful real library checks and a server-observed validated HTTP 206 from byte 196608, but the local-resume check never produces a completed/error report. At cleanup simctl reports no App process to terminate. Neither that report nor the short stderr contains a termination reason. An assertion about stale size alone cannot establish this failure's cause.

This increment preserves the existing tests and release gates. It records the seven awaits within that existing resume check, detects premature process disappearance, samples the exact launched executable once after a stalled report, and retains matching PID/new crash reports plus bounded logs from the fresh private simulator before cleanup. Diagnostics never substitute for success. The previous long-suite reordering now takes effect in the next normal CI run.

Local checks: TypeScript, 20 queue/storage groups, 16 production integration groups, 22 real fixture checks, existing driver tests and 25 release-policy tests passed. Nine targeted process-evidence controls cover invalid receipts, premature exit, missing diagnostics, stale/completed reports, permissions, PID identity and crash filtering. Existing phase/check inventories and assertion text match the parent. No production library code, distribution identity, screenshot count, timeout or binary/publication policy is changed. This is a diagnostic execution, not a claim the App failure is fixed.

Next: read the actual process/substage evidence from the new run, fix the demonstrated blocker without expanding scope, and continue the same-source compile/acceptance/publication loop. Do not ask for repeat authorization, rerun obsolete uploads, or publish a known failed build.
