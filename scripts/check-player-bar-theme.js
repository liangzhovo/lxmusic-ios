/* Production helper and PlayerBar render regression; native screenshots remain required. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
function load(file, mocks = {}) {
  const exports = {}
  const compiled = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    fileName: file, reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  })
  assert.equal((compiled.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0)
  vm.runInNewContext(compiled.outputText, { exports, require(name) {
    assert.ok(Object.hasOwn(mocks, name), `Unexpected dependency ${name}`)
    return mocks[name]
  } })
  return exports
}
const colours = load('src/theme/playerBar.ts')
let theme = { isDark: true, 'c-main-background': '#121212', 'c-content-background': '#333333' }
let keyboardShown = false
let autoHide = false
const jsx = (type, props) => ({ type, props })
const PlayerBar = load('src/components/player/PlayerBar/index.tsx', {
  react: { memo: x => x, useMemo: factory => factory() },
  'react/jsx-runtime': { jsx, jsxs: jsx },
  'react-native': { View: 'View' },
  '@/utils/hooks': { useKeyboard: () => ({ keyboardShown }) },
  '@/utils/tools': { createStyle: x => x },
  '@/store/theme/hook': { useTheme: () => theme },
  '@/store/setting/hook': { useSettingValue: () => autoHide },
  '@/theme/playerBar': colours,
  './components/Pic': { default: 'Pic' },
  './components/Title': { default: 'Title' },
  './components/PlayInfo': { default: 'PlayInfo' },
  './components/ControlBtn': { default: 'ControlBtn' },
}).default
for (const isDark of [true, false, true]) {
  for (const background of ['#121212', '#161616', '#000000', '#ffffff', 'rgba(20,20,20,0.8)']) {
    theme = { ...theme, isDark, 'c-main-background': background }
    const before = JSON.stringify(theme)
    const expected = isDark ? background : theme['c-content-background']
    assert.equal(colours.playerBarBackground(theme), expected)
    const view = PlayerBar({ isHome: true })
    assert.equal(view.props.style.backgroundColor, expected)
    assert.equal(view.props.testID, 'player-bottom-bar')
    assert.equal(view.props.children[0].type, 'Pic')
    assert.equal(view.props.children[0].props.isHome, true)
    assert.equal(view.props.children[2].props.children.type, 'ControlBtn')
    assert.equal(JSON.stringify(theme), before)
  }
}
keyboardShown = true
assert.notEqual(PlayerBar({}), null)
autoHide = true
assert.equal(PlayerBar({}), null)
keyboardShown = false
assert.notEqual(PlayerBar({}), null)
console.log('PASS production dock: dark page colour, unchanged light colour, live theme changes, controls, and keyboard visibility')
