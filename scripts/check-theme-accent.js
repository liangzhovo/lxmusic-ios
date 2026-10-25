// Test the shared production hook and actual selected components. Colour-only
// list tests miss navigation/list-name regressions on neutral palettes.
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript')
const root = path.resolve(__dirname, '..'), read = p => fs.readFileSync(path.join(root, p), 'utf8')
const load = (file, mocks = {}) => {
  const result = ts.transpileModule(read(file), { fileName: file, reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } })
  assert.equal((result.diagnostics || []).filter(d => d.category === 1).length, 0, file)
  const exports = {}
  vm.runInNewContext(result.outputText, { exports, setTimeout, clearTimeout, require: name => {
    assert.ok(name in mocks, `${file}: missing dependency ${name}`); return mocks[name]
  } }, { filename: file })
  return exports
}
const plain = x => JSON.parse(JSON.stringify(x))
const jsx = (type, props) => ({ type, props })
const runtime = { jsx, jsxs: jsx, Fragment: 'Fragment' }
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object'
  ? [tree, ...nodes(tree.props?.children)] : []
const readability = load('src/utils/readability.ts')
const colours = load('src/utils/playingColor.ts', { './readability': readability })
const accents = load('src/utils/themeAccent.ts', { './readability': readability, './playingColor': colours })
const themes = load('src/theme/themes/themes.ts').default
const palette = item => {
  const t = { isDark: item.isDark, ...item.config.themeColors }
  for (const [k, v] of Object.entries(item.config.extInfo)) t[k] = typeof v === 'string' && v.startsWith('var(') ? t[v.slice(4, -1)] : v
  return { ...t, 'c-content-background': t['c-primary-light-1000'], 'c-primary-font': t['c-primary'],
    'c-font': t['c-850'], 'c-font-label': t['c-450'], 'c-button-font': t['c-primary-alpha-100'],
    'c-button-background': t['c-primary-light-400-alpha-700'] }
}
const roles = ['c-primary-font', 'c-primary-font-active', 'c-primary-font-hover']
const evidence = []
const foreground = (value, theme, label, surface) => {
  const background = colours.songSurface(theme, surface)
  const item = { label, foreground: value, background, normal: theme['c-font'], secondary: theme['c-font-label'],
    contrast: readability.contrastRatio(value, background), chroma: colours.playingColorChroma(value, background),
    normalDistance: colours.playingColorDistance(value, theme['c-font'], background),
    secondaryDistance: colours.playingColorDistance(value, theme['c-font-label'], background) }
  assert.ok(item.contrast >= 4.8, `${label}: surface contrast ${item.contrast}`)
  assert.ok(item.chroma >= .085 && item.chroma <= .18, `${label}: black/white/grey or excessive chroma`)
  assert.ok(item.normalDistance >= .16, `${label}: merges with body text`)
  assert.ok(item.secondaryDistance >= .10, `${label}: merges with secondary text`)
  evidence.push(item)
}
let count = 0
const check = (name, fn) => { fn(); count++; console.log('PASS ' + name) }
const overlay = load('src/utils/overlaySurface.ts', { './readability': readability })
check('shared emphasis is chromatic in every shipped theme and does not change background ownership', () => {
  for (const item of themes) {
    const raw = palette(item), before = JSON.stringify(raw), prior = readability.readableTheme(raw)
    const theme = accents.readableThemeWithAccent(raw)
    assert.equal(JSON.stringify(raw), before, item.id + ': mutated source palette')
    for (const [key, value] of Object.entries(prior)) if (!roles.includes(key)) assert.deepEqual(theme[key], value, item.id + ':' + key)
    for (const role of roles) {
      foreground(theme[role], theme, item.id + ':' + role)
    }
    assert.equal(theme['c-primary'], raw['c-primary'], 'preserve original hue seed')
  }
})
check('old dark/neutral emphasis fails the new criterion rather than passing on contrast alone', () => {
  for (const id of ['black', 'grey']) {
    const t = readability.readableTheme(palette(themes.find(x => x.id === id)))
    assert.throws(() => foreground(t['c-primary-font'], t, 'old:' + id))
  }
})
check('custom same-colour body text and theme switching remain distinct without hardcoded white/black', () => {
  for (const isDark of [false, true]) {
    const t = { isDark, 'c-content-background': isDark ? '#121212' : '#ffffff',
      'c-primary': '#2b75a5', 'c-primary-font': '#2b75a5', 'c-font': '#2b75a5', 'c-font-label': '#2b75a5',
      'c-button-font': '#2b75a5', 'c-button-background': 'transparent' }
    const theme = accents.readableThemeWithAccent(t)
    for (const role of roles) foreground(theme[role], theme, `custom:${isDark}:${role}`)
  }
})
let current = palette(themes.find(x => x.id === 'black'))
const platform = { OS: 'ios' }
const react = { useContext: () => current, useState: x => [x, () => {}], useEffect: () => {},
  useRef: x => ({ current: x }), useImperativeHandle: () => {}, forwardRef: f => f, memo: f => f }
const native = { View: 'View', ScrollView: 'ScrollView', TouchableOpacity: 'TouchableOpacity', TouchableHighlight: 'TouchableHighlight',
  FlatList: 'FlatList', StyleSheet: { create: x => x }, PixelRatio: { getFontScale: () => 1 }, Platform: platform }
const hook = load('src/store/theme/hook.ts', { react, 'react-native': native, '@/utils/themeAccent': accents,
  './state': { ThemeContext: {} }, '@/store/setting/state': { default: { setting: {} } } })
check('actual iOS hook applies the policy once per theme object; Android receives the original palette', () => {
  for (const id of ['black', 'green', 'grey', 'purple', 'black']) {
    current = palette(themes.find(x => x.id === id))
    const result = hook.useTheme()
    assert.deepEqual(plain(result), plain(accents.readableThemeWithAccent(current)))
    assert.strictEqual(result, hook.useTheme(), 'cache did not reuse transformed theme')
    for (const role of roles) foreground(result[role], result, 'hook:' + id + ':' + role)
  }
  platform.OS = 'android'; assert.strictEqual(hook.useTheme(), current); platform.OS = 'ios'
})
const common = { react, 'react/jsx-runtime': runtime, 'react-native': native, '@/store/theme/hook': hook,
  '@/components/common/Icon': { Icon: 'Icon' }, '@/components/common/Text': { default: 'Text' },
  '@/utils/tools': { createStyle: x => x, confirmDialog: () => Promise.resolve(false), exitApp: () => {} },
  '@/store/setting/hook': { useSettingValue: () => false }, '@/core/common': { exitApp: () => {}, setNavActiveId: () => {} },
  '@/store/common/hook': { useNavActiveId: () => 'nav_top', useStatusbarHeight: () => 0 },
  '@/config/constant': { NAV_MENUS: [{ id: 'nav_top', icon: 'top' }, { id: 'nav_love', icon: 'love' }] },
  '@/utils/hooks': { useLayoutSize: () => ({ size: 'expanded' }), useWindowSize: () => ({ width: 800, height: 600 }) } }
const noSlab = tree => {
  for (const node of nodes(tree)) for (const style of [node.props?.style].flat(Infinity).filter(Boolean)) {
    assert.ok(!style.backgroundColor || style.backgroundColor === 'transparent', 'added selected background')
    assert.ok(!style.borderLeftWidth && !style.borderTopWidth, 'added selected stripe')
  }
}
check('real sidebar and bottom tabs use chromatic selection without selected slabs', () => {
  const Aside = load('src/screens/Home/Horizontal/Aside.tsx', { ...common, '@/theme': { BorderWidths: { normal: 1 } } }).default
  const Tabs = load('src/screens/Home/Vertical/NavigationTabs.tsx', { ...common,
    '@/utils/songLayout': load('src/utils/songLayout.ts'), '@/lang': { useI18n: () => x => x } }).default
  for (const item of themes) {
    current = palette(item)
    const t = hook.useTheme()
    const entries = nodes(Aside()).filter(n => typeof n.type === 'function' && n.props.id)
    assert.equal(entries.length, 2)
    const active = entries[0].type(entries[0].props), normal = entries[1].type(entries[1].props)
    assert.equal(nodes(active).find(n => n.type === 'Icon').props.color, t['c-primary-font-active'])
    assert.equal(nodes(normal).find(n => n.type === 'Icon').props.color, t['c-font-label'])
    noSlab(active); noSlab(normal)
    const tabs = nodes(Tabs()).filter(n => n.type === 'TouchableOpacity')
    assert.equal(tabs.length, 2)
    for (const [index, tab] of tabs.entries()) {
      assert.equal(tab.props.accessibilityState.selected, index === 0)
      for (const node of nodes(tab).filter(n => ['Icon', 'Text'].includes(n.type))) assert.equal(node.props.color, index === 0 ? t['c-primary-font'] : t['c-font-label'])
      noSlab(tab)
    }
  }
})
check('real list names retain the upstream chevron/text distinction and no background', () => {
  const items = [{ id: 'selected', name: 'Current list' }, { id: 'other', name: 'Other list' }]
  const Lists = load('src/screens/Home/Views/Mylist/MyList/List.tsx', { ...common,
    '@/store/list/hook': { useActiveListId: () => 'selected', useListFetching: () => false, useMyList: () => items },
    '@/utils/data': { getListPosition: async() => 0, saveListPosition: async() => {} }, '@/core/list': { setActiveList: () => {} },
    '@/utils/pixelRatio': { scaleSizeH: x => x }, '@/components/common/Loading': { default: 'Loading' } }).default
  for (const item of themes) {
    current = palette(item)
    const list = nodes(Lists({ onShowMenu: () => {} })).find(n => n.type === 'FlatList')
    assert.ok(list)
    for (const [index, item] of items.entries()) {
      const child = list.props.renderItem({ item, index }), row = child.type(child.props), t = hook.useTheme()
      assert.equal(nodes(row).find(n => n.type === 'Text').props.color, index === 0 ? t['c-primary-font'] : t['c-font'])
      assert.equal(nodes(row).filter(n => n.props?.name === 'chevron-right').length, index === 0 ? 1 : 0)
      noSlab(row)
    }
  }
})
check('real menu active/focused labels keep colour emphasis; only the original popup surface is filled', () => {
  let focused = null
  const Menu = load('src/components/common/Menu.tsx', { ...common, '@/utils/overlaySurface': overlay,
    '@/utils/menuLayout': load('src/utils/menuLayout.ts'), '@/utils/playingColor': colours, '@/utils/hooks/useSongKeyboard': { default: () => focused },
    './Text': { default: 'Text' }, './Modal': { default: 'Modal' }, '@/utils/pixelRatio': { setSpText: n => n + 2 } }).default
  for (const item of themes) for (focused of [null, 'other']) {
    current = palette(item)
    const shell = Menu({ menus: [{ action: 'selected', label: 'Selected' }, { action: 'other', label: 'Other' }], activeId: 'selected', onPress: () => {} }, {})
    assert.equal(shell.props.bgColor, 'transparent')
    const child = shell.props.children, rows = nodes(child.type(child.props)).filter(n => n.type === 'TouchableHighlight'), t = hook.useTheme()
    assert.equal(rows.length, 2)
    for (const [index, row] of rows.entries()) {
      const value = nodes(row).find(n => n.type === 'Text').props.color
      const surface = overlay.overlaySurface(t).backgroundColor
      assert.equal(value, index === 0 || focused ? colours.playingColor(t, surface) : t['c-font'])
      if (index === 0 || focused) foreground(value, t, item.id + ':menu:' + index, surface)
      noSlab(row)
    }
  }
})
check('runtime evidence measures the same shared transform and rejects a failed accent', () => {
  const s = read('src/tests/uiSmoke.tsx')
  assert.ok(s.includes('readableThemeWithAccent(themeState.theme)'))
  assert.ok(s.includes('colourOK && accentsOK && menuAccentOK'))
  assert.ok(s.includes('activeId="add"'))
  for (const role of roles) assert.ok(s.includes(`'${role}'`))
})
fs.mkdirSync(path.join(root, 'build/checks'), { recursive: true })
fs.writeFileSync(path.join(root, 'build/checks/theme-accents.json'), JSON.stringify(evidence, null, 2))
console.log(`${count} shared-accent groups passed; ${themes.length} shipped themes and actual component props checked. Native screenshots remain a separate gate.`)
