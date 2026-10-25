const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')

const transpile = file => {
  const out = ts.transpileModule(read(file), {
    fileName: file,
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  })
  const errors = (out.diagnostics || []).filter(item => item.category === ts.DiagnosticCategory.Error)
  assert.equal(errors.length, 0, `${file}: ${errors.map(item => item.messageText).join('; ')}`)
  return out.outputText
}
const loadAnimation = () => {
  const exports = {}
  vm.runInNewContext(transpile('src/components/player/coverAnimation.ts'), { exports, console }, { filename: 'coverAnimation.ts' })
  return exports
}

const animation = loadAnimation()
assert.equal(animation.COVER_REVOLUTION_MS, 120000)

// Execute the production helper: resume the current angle, finish the current revolution,
// then continue with full revolutions. Disposal must make late native callbacks inert.
{
  let readPhase, complete
  const durations = []
  const values = []
  const driver = {
    stop(fn) { if (fn) readPhase = fn },
    set(value) { values.push(value) },
    run(duration, fn) { durations.push(duration); complete = fn },
  }
  const dispose = animation.startCoverRotation(driver, true)
  readPhase(0.25)
  assert.equal(durations[0], 90000)
  complete(true)
  assert.deepEqual(durations, [90000, 120000])
  dispose()
  complete(true)
  assert.equal(durations.length, 2)
  assert.ok(values.includes(0.25) && values.includes(0))
}
{
  let readPhase
  const durations = []
  const dispose = animation.startCoverRotation({
    stop(fn) { if (fn) readPhase = fn }, set() {}, run(duration) { durations.push(duration) },
  }, false)
  readPhase(0.5)
  dispose()
  assert.deepEqual(durations, [])
}

// Compile the actual production component and both layout call sites, then assert the
// lifecycle/accessibility contracts that prevent hidden/background/Reduce Motion rotation.
for (const file of [
  'src/components/player/PlayerCover.tsx',
  'src/screens/PlayDetail/Horizontal/Pic.tsx',
  'src/screens/PlayDetail/Vertical/Pic.tsx',
  'src/screens/PlayDetail/Vertical/index.tsx',
  'src/screens/Home/Views/Setting/settings/Player/CoverStyle.tsx',
]) transpile(file)

const cover = read('src/components/player/PlayerCover.tsx')
for (const token of [
  "useSettingValue('playDetail.coverStyle')",
  'useIsPlay()',
  'AccessibilityInfo.isReduceMotionEnabled()',
  "AccessibilityInfo.addEventListener('reduceMotionChanged'",
  "AppState.addEventListener('change'",
  'useNavigationComponentDidAppear',
  'useNavigationComponentDidDisappear',
  "style != 'cd'",
  'playing && foreground && visible && active && !reduceMotion',
  'useNativeDriver: true',
]) assert.ok(cover.includes(token), `missing production cover contract: ${token}`)

const defaults = read('src/config/defaultSetting.ts')
const types = read('src/types/build88.d.ts')
const settings = read('src/screens/Home/Views/Setting/settings/Player/index.tsx')
assert.ok(defaults.includes("'playDetail.coverStyle': 'square'"), 'square must remain the default')
assert.ok(types.includes("'playDetail.coverStyle': 'cd' | 'square'"))
assert.ok(settings.includes('<CoverStyle />'))
assert.ok(read('src/screens/PlayDetail/Horizontal/Pic.tsx').includes('<PlayerCover'))
assert.ok(read('src/screens/PlayDetail/Vertical/Pic.tsx').includes('<PlayerCover'))
assert.ok(read('src/screens/PlayDetail/Vertical/index.tsx').includes('active={pageIndex == 0}'))

// Fixed upstream visual contract, in addition to the retained lifecycle checks.
for (const token of ["width * 0.9", "width * 0.07", "['88%', '88%']", "borderRadius: 6", "opacity: 0.8", "LXDiscArtwork", "LXDiscMount"]) assert.ok(cover.includes(token), 'Missing upstream CD geometry: ' + token)
const native = read('ios/LxMusicMobile/LXDiscArtwork.m')
for (const token of ['CGContextEOClip', 'CGRectMake(38.4, 38.4, 23.2, 23.2)', 'CGRectMake(2, 2, 96, 96)', 'CGRectMake(30, 30, 40, 40)', 'kCGBlendModeMultiply', 'kCGBlendModeExclusion', 'CGContextSetLineWidth(c, 1.2)', 'CGContextSetLineWidth(c, .4)']) assert.ok(native.includes(token), 'Missing native SVG layer: ' + token)
assert.ok(read('ios/LxMusicMobile.xcodeproj/project.pbxproj').includes('LXDiscArtwork.m in Sources'))

// Full-player queue preservation remains enforced by the existing check-track-player-queue.js gate.
console.log('Build88 cover: production helper/lifecycle/layout/settings contracts passed; native Xcode/runtime gates remain required.')
