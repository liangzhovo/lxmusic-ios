# Build87 — latest-target seeking and independent system-theme presets

Base: `c458b17ce7bf3f0dc7684a02c4aead7092b542ca` (Actions #84 / Build86).
Desktop behavior reference: `lyswhut/lx-music-desktop@abcbf5fa00b0b9f2c532a80b10ad8906ee4b22ab`, `src/renderer/views/Setting/components/ThemeSelectorModal.vue`, `src/renderer/core/useApp/useEventListener.ts`. This is a native React Native adaptation, not an embedded Electron view.

## Changes and cross-checks

1. The old iOS seek verifier repeatedly submitted its captured target after timed reads. Overlapping calls could therefore restore historical targets. The production progress listener now debounces rapid inputs for 120 ms, accumulates the immediately displayed target, and allows only one in-flight operation. A revision rejects delayed results and pre-seek polling. Changing media, stopping, errors and listener cleanup cancel pending requests. Native position zero is accepted.
2. The iOS seek verifier submits once and only reads the real native clock afterwards. No synthesized progress, extra audio reset or changed native getPosition deadline is introduced. MP3 uses TrackPlayer; FLAC keeps its existing native implementation behind the same public seeking path.
3. Automatic themes use `theme.id=auto`, independent `theme.lightId`/`theme.darkId`, and the existing persisted `common.isAutoTheme` compatibility flag. The picker separates light/dark themes and includes the split-color automatic entry. Invalid or deleted presets fall back within the correct appearance group. Fixed themes ignore system changes.
4. Native automatic mode clears the window override to `.unspecified`. The system preference comes from the window scene, not the previously forced window. Startup, live Appearance events, foreground activation and settings edits refresh through guarded asynchronous paths. Stored theme objects are cloned before resolving mutable colors/paths.
5. No original settings file was removed. Theme backgrounds/assets, decoder, DSP, cache format, resource replacement path, sync protocol, signing identity and bundle identifier remain unchanged. The pre-existing safe-area and fixed-window code in LXWindowInsets.swift remains byte-identical when the two added appearance methods are excluded; the new regression reconstructs and checks its original SHA256 `0e02398721406aac184fd493aa2fc7a69f3e019d174c5784acc6ec4b6d041d88`. Only this explicitly extended file's fingerprint is updated in BUILD86_BASELINE_HASHES.json; all other protected fingerprints remain unchanged.
6. Build increments to 87. Earlier regression files' exact release-number assertions move to 87, not a relaxed range. Build80's release-note check now targets CHANGELOG_BUILD87.md; CHANGELOG.md and all earlier notes remain byte-identical. New translations are additive through the typed language index; the original three language JSON files are unchanged.

## Pre-submission execution

- Build87: 11 executable behavioral groups, including actual shortcut/progress listener integration, stale in-flight completion, canceled requests, zero/invalid values, read-only iOS settling, preset fallback/legacy behavior, actual theme refresh races, system events despite fixed-window overrides, listener cleanup, actual picker render props/callbacks, and mandatory CI gates.
- Existing Build79, Build80, Build81, Build82, Build84, Build86/shared accent, TrackPlayer timing, SwiftAudio position-cache, audio-cache, sync/catalog race and iPad layout checks run against the edited source. Build85 also runs with its explicit Node fixture codec option, not misreported as a bundled-codec test.
- Source syntax parse, Swift syntax parse, Python driver compilation/tests, Podfile syntax and whitespace checks are separate from semantic/native compilation.
- This container cannot resolve registry.npmjs.org (EAI_AGAIN), has no installed React Native dependency tree and no Xcode. Full-project semantic TypeScript, CocoaPods, actual Swift/Objective-C linking, simulator execution and Archive/IPA therefore remain mandatory Actions gates. No native or device result is predeclared.

## Native evidence added without replacing old gates

- MP3 and FLAC each send a rapid hardware-key command burst through the existing native test bridge and actual production shortcut/progress listeners. Required evidence includes the accumulated targets, native playback advancing after the final target and no old UI positions restoring themselves afterwards. The 3000 ms native query limit remains unchanged.
- A fresh app process runs the real settings UI and theme initialization while the driver changes simulated OS light/dark appearance. It checks independent preset edits, fixed-theme isolation, re-entering automatic mode and a second-process persistence check. Reports: `system-theme.json`, `system-theme-restart.json`; screenshots: `feature-theme-*.png`.
- Both feature reports are required before release. The original online/offline checks, all 54 existing UI screenshots, source SHA metadata, archive metadata and IPA checksum gates remain enabled. Actual results must be matched to this submission's commit and Actions run.

## Follow-up verification: legacy picker and fallback selection

The actual picker render test exposed an upgrade inconsistency: with legacy automatic mode, `theme.id=red` and an untouched `theme.lightId=green`, the resolver applied red but the automatic swatch and selected light preset showed green. A failing test reproduced the RGB mismatch (`77,175,124` versus `214,69,65`) before the correction.

The picker now derives the legacy light preset without mutating stored settings. Both selection indicators use the same appearance-group resolver as the active theme; missing/deleted or wrong-group presets visibly select the actual fallback. A fixed manual theme remains independent of the saved automatic presets. The existing actual-component behavioral group now covers all three cases. No native audio, cache, scene, dependencies, release number or CI gate changes accompany this correction.

An independent before/after test also ran the actual progress listener together with the actual seek module against a deterministic native-clock stub: requesting 100 seconds and then 110 seconds 50 ms later produced 12 native seek submissions on `c458b17`, versus a single final 110-second submission on the Build87 implementation. A rapid mixed-direction sequence ending at zero also produced only the final zero-second submission. These are executable source-level comparisons, not a device-audio measurement; the native MP3/FLAC and system-theme Actions gates remain required.

## Run87 native failure: iOS capability gate

Actions Run87 (`35002681712`, commit `df85965c`) compiled the native simulator and passed all 32 online checks, 11 offline checks and 54 UI captures. Both actual keyboard bursts accumulated targets `[8,13,8,13,8,13]`, reached target 13 and continued playback (MP3 14.000325374 s; FLAC 14.6746875 s). The system-theme phase failed waiting for OS dark: the driver successfully changed simulator appearance, but the active theme remained blue and `systemDark=false`. Archive/IPA were blocked; this run is not a successful release.

`getIsSupportedAutoTheme()` parsed `osVer`, which reads Android-only `Platform.constants.Release`. iOS does not supply this constant, so the result was NaN and the Appearance subscription was never installed. The earlier initializer test mocked this capability gate as true and therefore missed the integration bug. React Native's Platform contract supplies iOS system version via `Platform.Version`; Android Release handling is retained.

The new executable test imports the complete production tools module using iOS-shaped constants without Release. It failed on iOS 13.0 before the fix. It now checks iOS 12/13/17/26, Android 4/5/14, and runs the actual theme initializer with the actual capability gate, live change delivery and cleanup. This adds a twelfth Build87 behavioral group; existing checks remain intact. The native phase now records OS version, support-gate result, Appearance value and direct scene preference for failure attribution. No simulated success, timeout relaxation, audio/native-cache change, UI gate removal or dependency update is involved. Native success still requires the new commit's full Actions run.
