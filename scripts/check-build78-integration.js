const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const paths = [
  'src/plugins/player/cache/DiskAudioCache.ts', 'src/plugins/player/cache/index.ts',
  'src/core/music/online.ts', 'src/core/music/index.ts', 'src/core/init/player/preloadNextMusic.ts',
  'src/plugins/player/index.ts', 'src/plugins/player/utils.ts', 'src/plugins/player/nativeFlac.ts',
  'src/plugins/player/engine/resourceLoader.ts',
  'src/components/WindowContent.tsx', 'src/components/common/Modal.tsx', 'src/components/common/Dialog.tsx',
  'src/components/common/Popup.tsx', 'src/components/common/ConfirmAlert.tsx',
  'src/components/TimeoutExitEditModal.tsx', 'src/components/MusicAddModal/index.tsx',
  'src/components/MusicAddModal/MusicAddModal.tsx', 'src/screens/PlayDetail/Horizontal/index.tsx',
  'src/screens/PlayDetail/Horizontal/Player/ControlBtn.tsx', 'src/screens/PlayDetail/Horizontal/MoreBtn/Btn.tsx',
  'src/screens/PlayDetail/Horizontal/MoreBtn/MusicAddBtn.tsx', 'src/screens/PlayDetail/Horizontal/MoreBtn/TimeoutExitBtn.tsx',
]
for (const p of paths) {
  const result = ts.transpileModule(read(p), { fileName: p, reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } })
  const errors = (result.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error)
  assert.equal(errors.length, 0, p + ': ' + errors.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n'))
}
const online = read('src/core/music/online.ts')
assert.ok(online.indexOf('const local = await lookupAudioCache') < online.indexOf('const cachedUrl = await getStoreMusicUrl'))
assert.ok(online.includes('if (cacheAudio) queueAudioCache'))
assert.ok(read('src/core/init/player/preloadNextMusic.ts').includes('cacheAudio: false'))
const native = read('ios/LxMusicMobile/AppDelegate.mm')
assert.ok(native.includes('if (url.isFileURL)'))
assert.ok(native.includes('self.streamData = data'))
assert.ok(native.includes('openGeneration != self.openRequestGeneration'))
assert.ok(!read('src/plugins/player/nativeFlac.ts').includes('Native local FLAC playback is disabled'))
assert.ok(!read('src/plugins/player/utils.ts').includes('await releaseCurrentAudioCacheURL()'))
const adapter = read('src/plugins/player/cache/index.ts')
assert.ok(adapter.includes('Application Support/LXAudioCache/v1'))
assert.ok(adapter.includes('NSURLIsExcludedFromBackupKey: true'))
assert.ok(read('ios/LxMusicMobile.xcodeproj/project.pbxproj').includes('LXWindowInsets.swift in Sources'))
assert.ok(JSON.parse(read('package.json')).versionCode >= 78)
console.log(`${paths.length} changed TS/TSX files parsed; cache/native/layout integration contracts passed.`)
