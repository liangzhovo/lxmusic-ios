// Syntax and source-contract checks only: not an iOS build or a UI snapshot test.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const horizontal = 'src/screens/PlayDetail/Horizontal/'
const sourcePaths = [
  'src/components/WindowContent.tsx', 'src/components/PageContent.tsx',
  'src/components/common/Popup.tsx', 'src/utils/ipadWindow.ts',
  `${horizontal}index.tsx`, `${horizontal}Pic.tsx`,
  `${horizontal}Player/index.tsx`, `${horizontal}Player/PlayInfo.tsx`,
  `${horizontal}Player/ControlBtn.tsx`, `${horizontal}components/Header.tsx`,
  `${horizontal}components/ActionBar.tsx`, `${horizontal}components/PlaylistBtn.tsx`,
]
const read = name => fs.readFileSync(path.join(root, name), 'utf8')
let checks = 0
const check = (name, test) => { test(); checks++; console.log(`PASS ${name}`) }
for (const name of sourcePaths) {
  check(`syntax: ${name}`, () => {
    const result = ts.transpileModule(read(name), {
      fileName: name, reportDiagnostics: true,
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    })
    const errors = (result.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error)
    assert.equal(errors.length, 0, errors.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n'))
  })
}
check('native top clearance is consumed without another app title strip', () => {
  const code = ts.transpileModule(read('src/components/WindowContent.tsx'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const exports = {}
  vm.runInNewContext(code, { exports, require: () => ({ createContext: value => ({ Provider: () => null }), Platform: { OS: 'test' }, StyleSheet: { create: value => value, absoluteFillObject: {} } }) })
  for (const [top, expected] of [[0, 0], [24, 24], [36, 36], [48, 48], [-4, 0]]) {
    assert.equal(exports.getWindowControlTopPadding(top), expected)
  }
})
check('all dimensions produce zero horizontal window-control allowance', () => {
  const code = ts.transpileModule(read('src/utils/ipadWindow.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
  const exports = {}
  vm.runInNewContext(code, { exports, require: () => ({}) })
  for (const [w, h] of [[1366, 1024], [1194, 834], [1024, 768], [850, 600], [600, 850], [0, 0]]) {
    assert.equal(exports.getIPadWindowControlsLeadingInset(w, h), 0)
  }
})
check('horizontal player has one safe-area owner and keeps controls in its left column', () => {
  const content = read(`${horizontal}index.tsx`)
  assert.ok(!content.includes('<PageContent'))
  assert.ok(!content.includes('<StatusBar'))
  assert.ok(content.indexOf('<SongInfo />') < content.indexOf('<Player />'))
  assert.ok(content.indexOf('<Player />') < content.indexOf('<View style={styles.right}>'))
  assert.ok(!read(`${horizontal}components/Header.tsx`).includes('paddingLeft'))
})
check('dock order is progress, transport row, utility row', () => {
  const content = read(`${horizontal}Player/index.tsx`)
  assert.ok(content.indexOf('<PlayInfo />') < content.indexOf('<ControlBtn />'))
  assert.ok(content.indexOf('<ControlBtn />') < content.indexOf('<ActionBar />'))
  assert.ok(!content.includes('<SongInfo'))
})
check('transport row order', () => {
  const content = read(`${horizontal}Player/ControlBtn.tsx`)
  const positions = ['<PlayModeBtn', 'name="prevMusic"', "name={isPlay ? 'pause'", 'name="nextMusic"', '<PlaylistBtn'].map(s => content.indexOf(s))
  assert.ok(positions.every((p, i) => p >= 0 && (i === 0 || p > positions[i - 1])))
})
check('utility order and caller-positioned settings/effects', () => {
  const content = read(`${horizontal}components/ActionBar.tsx`)
  const positions = ['<CommentBtn', 'icon="slider"', '<MusicAddBtn', '<TimeoutExitBtn', 'icon="setting"'].map(s => content.indexOf(s))
  assert.ok(positions.every((p, i) => p >= 0 && (i === 0 || p > positions[i - 1])))
  assert.ok(content.includes('position="bottom" layoutMode="stacked"'))
  assert.ok(content.includes('position="bottom" direction="horizontal"'))
  assert.ok(!content.includes('position="left"'))
})
check('cover uses actual body layout; progress cannot cover time text', () => {
  assert.ok(read(`${horizontal}Pic.tsx`).includes('nativeEvent.layout'))
  assert.ok(!read(`${horizontal}Pic.tsx`).includes('useWindowSize'))
  assert.ok(!read(`${horizontal}Player/PlayInfo.tsx`).includes('absoluteFill'))
})
console.log(`${checks} checks passed. Native build, runtime layout and cache persistence NOT tested.`)
