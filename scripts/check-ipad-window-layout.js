// Focused source contracts, not a React Native render or a complete type check.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const read = name => fs.readFileSync(path.join(root, name), 'utf8')
const windowPath = 'src/components/WindowContent.tsx'
const popupPath = 'src/components/common/Popup.tsx'
const layoutPath = 'src/screens/PlayDetail/Horizontal/index.tsx'
const playerPath = 'src/screens/PlayDetail/Horizontal/Player/index.tsx'
const options = { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX }
let checks = 0
const check = (name, test) => { test(); checks++; console.log(`PASS ${name}`) }
for (const file of [windowPath, popupPath, layoutPath, playerPath]) {
  check(`syntax: ${file}`, () => {
    const result = ts.transpileModule(read(file), { fileName: file, reportDiagnostics: true, compilerOptions: options })
    assert.equal((result.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0)
  })
}
check('native clearance is not padded by another 36/40-point strip', () => {
  const exports = {}
  const code = ts.transpileModule(read(windowPath), { compilerOptions: options }).outputText
  vm.runInNewContext(code, { exports, require: () => ({ createContext: value => ({ Provider: () => null }), Platform: { OS: 'test' }, StyleSheet: { create: value => value, absoluteFillObject: {} } }) })
  for (const [top, expected] of [[0, 0], [24, 24], [36, 36], [48, 48], [-4, 0]]) {
    assert.equal(exports.getWindowControlTopPadding(top), expected)
  }
})
check('iPad horizontal padding is not applied to visible content', () => {
  const content = read(windowPath)
  assert.ok(!/paddingLeft|paddingRight|translateX/.test(content))
  assert.ok(content.includes('style={styles.probe}'))
  assert.ok(content.includes('paddingTop: top, paddingBottom: bottom'))
})
check('the whole player remains inside the left column', () => {
  const content = read(layoutPath)
  const start = content.indexOf('<ScrollView style={[styles.left,')
  const player = content.indexOf('<Player />')
  const right = content.indexOf('<View style={styles.right}>')
  assert.ok(start >= 0 && player > start && right > player)
  assert.ok(!content.includes('<PageContent'))
  assert.ok(content.includes('appstateListener.remove()'))
})
check('popup direction uses explicit list/panel intent', () => {
  const content = read(popupPath)
  assert.ok(content.includes("panelPosition(Platform.OS == 'ios', kind, position)"))
  assert.ok(content.includes('panelBounds('))
})
check('native vertical region and modal roots consume safe insets exactly once', () => {
  assert.ok(read('ios/LxMusicMobile/LXWindowInsets.swift').includes('.safeArea(cornerAdaptation: .vertical)'))
  assert.ok(read('src/components/common/Modal.tsx').includes('<WindowInsetsScope><WindowContent>'))
  assert.ok(read(windowPath).includes("Platform.OS != 'ios' || consumed"))
  assert.ok(!read(popupPath).includes("const fill = { position: 'absolute'"))
})
check('timer and favorite editors remain centered while lists are explicit', () => {
  assert.ok(read('src/screens/PlayDetail/Horizontal/MoreBtn/MusicAddBtn.tsx').includes('<MusicAddModal position="center"'))
  assert.ok(read('src/screens/PlayDetail/Horizontal/MoreBtn/TimeoutExitBtn.tsx').includes('<TimeoutExitEditModal position="center"'))
  assert.ok(read('src/components/common/ConfirmAlert.tsx').includes('<Dialog position={position}'))
  assert.ok(read('src/components/common/Dialog.tsx').includes('<Popup ref={modalRef}'))
})
console.log(`${checks} focused checks passed. Native build, rendering and cache persistence NOT tested.`)
