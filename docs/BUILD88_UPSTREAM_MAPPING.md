# Build88 upstream mapping

Pinned source references retained from the initial preparation workflow:

- Any Listen `9e8e48a6307dad6de46cc549ad24528ca0f6193d`: `packages/view-main/src/components/layout/PlayDetail/LeftInfo/CoverCD.svelte`, `CoverSquare.svelte`, `Cover.svelte`; WebDAV client and extension at `packages/shared/nodejs/webdav-client` and `packages/shared/app/modules/worker/extensionService/internalExtension/extensions/webdav`; settings/sync at `packages/view-main/src/views/Setting/AppSetting/DataSyncWebdav.svelte` and `packages/shared/app/modules/sync/webdav`.
- LX Music Desktop `abcbf5fa00b0b9f2c532a80b10ad8906ee4b22ab`: `src/renderer/core/music/download.ts`, `src/renderer/store/download`, `src/renderer/views/Download`, `src/renderer/views/Setting/components/SettingDownload.vue`, `src/main/modules/winMain/rendererEvent/download.ts`.

The iOS port adapts these feature behaviours to the existing React Native application rather than embedding Svelte/Vue/Electron runtime components. Playback remains the project's original native player; DAV and file transfers are Foundation URLSession services, and portable backup/restore uses Apple cryptography and a cold-start transaction. Existing project attribution/licensing and README terms are retained. No upstream artwork or credentials are included.

Platform adaptations are visible in the UI: foreground-controlled download queue, verified conditional GET resumption, no generic partial-PUT promise, independent DAV directory/audio caches, and password-encrypted portable state instead of unencrypted song-list-only export. These are not claims of binary compatibility with desktop backup formats.
