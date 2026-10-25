# Build88 user-feedback rework (not a completed release)

Base: a9a683bae3da89276b3758cb1ff8e162c545a0a0. User rejected run105 UI despite CI passing.

## Required correction
- My Lists owns New List. Reuse its existing creation/rename dialog, select the new
  list after persistence, preserve rename text, and prevent double confirmation.
  WebDAV imports into an existing target; it cannot silently create a new list.
- Download enable/quality/target configuration lives in Settings on both layouts.
  Download navigation opens task progress and history, not the WebDAV settings form.
  The task page shows real bytes, percentage, speed, status, pause/continue/retry,
  completed history, export and add-to-existing-list actions. No fake tasks.
- CD appearance reference is Any Listen desktop's pinned submodule:
  any-listen/any-listen@9e8e48a6307dad6de46cc549ad24528ca0f6193d,
  packages/view-main/src/components/layout/PlayDetail/LeftInfo/CoverCD.svelte
  (blob 930dcde0d886f002009a482dda1a3381f8b7b1a6) and CoverSquare.svelte
  (blob cbaf51aaf9b7f06ae6636aeb4966713c135a269b). Original project is by
  lyswhut and contributors; its upstream LICENSE says Custom License based on
  AGPL v3.0, with additional non-commercial terms. No upstream music/artwork is bundled.

The UIKit renderer translates the visible SVG layers: 5% frame inset, four 7%
recessed mounts, 96% artwork, centre radius11.6 mask, radius20 multiply hub,
radius11 exclusion ring (stroke1.2), radius11.6 outer ring (stroke.4),120s rotation.
Square frame uses radius6 and a border/shadow. Existing app theme colours are used;
UIKit rendering and browser backdrop filtering must not be described as pixel-identical.
The iOS disc has a transparent hole rather than a theme-coloured circle.

Download layout/ownership reference: lyswhut/lx-music-desktop@abcbf5fa00b0b9f2c532a80b10ad8906ee4b22ab,
src/renderer/views/Download/index.vue and views/Setting/components/SettingDownload.vue.

## Verification boundary
Local TypeScript and focused production callback tests are required before commit.
The first Apple SDK compile and actual corrected screenshots remain pending CI.
Existing playback/queue/cache/README and device signing are unchanged. No database
reset or data migration is required. BUILD88_UI_HOLD.md prevents automatic publication
of an unreviewed candidate. The legacy Build87 and rejected run105 draft stay intact.
