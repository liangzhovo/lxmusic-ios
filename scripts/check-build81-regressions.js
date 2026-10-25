// Executable layout policies + rendering contracts; not a physical iPad test.
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript')
const root = path.resolve(__dirname, '..')
const source = p => fs.readFileSync(path.join(root, p), 'utf8')
const load = (file, mocks = {}) => {
  const exports = {}
  const result = ts.transpileModule(source(file), { fileName: file, reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } })
  assert.equal((result.diagnostics || []).filter(d => d.category === 1).length, 0, file)
  vm.runInNewContext(result.outputText, { exports, require: name => {
    assert.ok(name in mocks, `Missing mock ${name} in ${file}`); return mocks[name]
  }, console, setTimeout, clearTimeout })
  return exports
}
let count = 0
const check = (name, fn) => { fn(); count++; console.log(`PASS ${name}`) }
const jsx = (type, props) => ({ type, props })
const reactNative = { View: 'View', StyleSheet: { create: s => s, absoluteFillObject: {} },
  Platform: { OS: 'test' } }
const jsxRuntime = { jsx, jsxs: jsx, Fragment: 'Fragment' }
const theme = { isDark: false, 'c-content-background': '#ffffff', 'c-font': '#333333', 'c-font-label': '#555555', 'c-primary-font': '#236687' }
const readability = load('src/utils/readability.ts')
const layout = load('src/utils/songLayout.ts')
const overlay = load('src/utils/overlaySurface.ts', { './readability': readability })
let horizontal = false
const mocks = { react: { useState: () => [720, () => {}] }, 'react/jsx-runtime': jsxRuntime,
  'react-native': reactNative, './Text': { default: 'Text' }, './SongRowContent': { default: 'SongRowContent' },
  '@/store/theme/hook': { useTheme: () => theme }, '@/utils/hooks': { useHorizontalMode: () => horizontal },
  '@/utils/songLayout': layout, '@/utils/selectionColors': load('src/utils/selectionColors.ts'), '@/utils/playingColor': load('src/utils/playingColor.ts', { './readability': load('src/utils/readability.ts') }) }
const textOf = v => Array.isArray(v) ? v.map(textOf).join('') : v && typeof v === 'object' ? textOf(v.props?.children) : v ?? ''
check('native clearance is used once, including zero and already inset content', () => {
  const w = load('src/components/WindowContent.tsx', { 'react/jsx-runtime': jsxRuntime,
    react: { createContext: () => ({ Provider: 'Provider' }) }, 'react-native': reactNative })
  for (const value of [0, 20, 36, 44, 64, 100]) assert.equal(w.getWindowControlTopPadding(value), value)
  assert.equal(w.getWindowControlTopPadding(-10), 0)
  assert.equal(w.getWindowControlTopPadding(NaN), 0)
  const native = source('ios/LxMusicMobile/LXWindowInsets.swift')
  assert.ok(native.includes('self.edgeInsets(for: .safeArea(cornerAdaptation: .vertical))'))
  assert.ok(native.includes('max(0, insets.top)'))
  assert.ok(!source('src/components/WindowContent.tsx').includes('safeTop + getWindowControlTopPadding'))
})
check('portrait table headers return null, landscape headers remain present', () => {
  const Header = load('src/components/common/SongTableHeader.tsx', mocks).default
  horizontal = false; assert.equal(Header({}), null)
  horizontal = true; assert.equal(Header({}).type, 'View')
})
check('portrait song renderer keeps the source beside the title and singer below', () => {
  horizontal = false
  const Row = load('src/components/common/SongRowContent.tsx', mocks).default
  const tree = Row({ name: '蓝莲花', singer: '许巍', source: 'wy', album: '不可显示的专辑列', interval: '04:30' })
  const text = textOf(tree)
  assert.ok(text.includes('蓝莲花') && text.includes('wy') && text.includes('许巍') && text.includes('04:30'))
  assert.ok(!text.includes('不可显示的专辑列'))
  assert.equal(tree.props.children[0].type, 'View')
})
check('landscape song renderer shows separate, equal flexible metadata columns', () => {
  horizontal = true
  const Row = load('src/components/common/SongRowContent.tsx', mocks).default
  const tree = Row({ name: '歌曲', singer: '艺术家', album: '专辑', interval: '04:30' })
  const fields = tree.props.children[0].props.children.filter(Boolean)
  assert.equal(fields.length, 3)
  for (const field of fields) assert.equal(field.props.style[0].flex, 1)
  assert.equal(layout.SONG_TIME_WIDTH, 70)
  assert.ok(layout.SONG_ACTION_WIDTH >= 44)
  assert.ok(tree.props.style.paddingRight >= 12)
})
check('layout switches without restart; narrow windows never keep table mode', () => {
  const adaptive = load('src/utils/layout.ts')
  for (const [w, h, expected] of [[1366,1024,true],[500,900,false],[700,1000,false],[1100,800,true],[500,300,false],[1366,1024,true]]) {
    const wide = adaptive.shouldUseIPadLayout(w,h)
    assert.equal(wide, expected)
    assert.equal(layout.songColumns(w, wide).compact, !expected)
  }
  assert.equal(layout.songColumns(520,true).album,false)
  assert.equal(layout.songColumns(800,true).album,true)
})
check('compact library selector replaces rather than duplicates the title toolbar', () => {
  assert.ok(source('src/screens/Home/Views/Mylist/index.tsx').includes('listSelector={sidebar ? undefined : <MyList compact />}'))
  assert.ok(source('src/screens/Home/Views/Mylist/MusicList/index.tsx').includes('<ActiveList listSelector={listSelector}'))
  // Preserve the no-duplicate-toolbar contract by rendering it and invoking its callbacks.
  // Build88 intentionally replaces the obsolete top-scroll action with locate-playing.
  require('./check-mylist-location').assertCompactLibraryToolbar()
})
check('online, library and player queue share row geometry and compact renderer', () => {
  for (const file of ['src/components/OnlineList/ListItem.tsx','src/screens/Home/Views/Mylist/MusicList/ListItem.tsx',
    'src/screens/PlayDetail/Horizontal/components/PlaylistBtn.tsx']) {
    assert.ok(source(file).includes('SONG_ROW_HEIGHT'), file)
    assert.ok(source(file).includes('<SongRowContent'), file)
  }
})
check('popup cards differ from their backdrop and provide real iOS shadows', () => {
  assert.equal(overlay.OVERLAY_BACKDROP, 'transparent')
  for (const dark of [false,true]) {
    const bg = dark ? '#161616' : '#ffffff'
    const card = overlay.overlaySurface({ isDark: dark, 'c-content-background': bg })
    assert.notEqual(card.backgroundColor, readability.compositeColor(bg,bg))
    assert.ok(card.borderWidth >= 1 && card.shadowOpacity > 0 && card.shadowRadius > 0)
  }
})
check('all shared secondary menu containers apply the distinct card surface', () => {
  for (const file of ['Menu.tsx','Popup.tsx','Dialog.tsx','DorpDownPanel/Panel.tsx']) {
    assert.ok(source('src/components/common/'+file).includes('overlaySurface(theme)'),file)
  }
  assert.ok(source('src/components/common/Modal.tsx').includes('bgColor = OVERLAY_BACKDROP'))
})
check('anchored menu respects safe origin and clamps all four edges at every size', () => {
  for (const [w,h] of [[1366,900],[700,430],[390,760],[320,220],[120,100],[0,0]]) {
    for (const [x,y] of [[10,10],[w-20,40],[w-10,h-10],[w+50,h+100]]) {
      const b = overlay.anchoredMenuBounds(w,h,{x:x+100,y:y+64,w:44,h:44},200,500,{x:100,y:64})
      assert.ok(b.left>=0 && b.top>=0 && b.width>=0 && b.height>=0)
      assert.ok(b.left+b.width<=w+0.01 && b.top+b.height<=h+0.01,JSON.stringify(b))
    }
  }
})
check('toolbar buttons never shrink their text or wrap; overflow scrolls instead', () => {
  const actions = source('src/components/common/ListActionBar.tsx')
  assert.ok(actions.includes('<ScrollView horizontal'))
  assert.ok(actions.includes('numberOfLines={1}'))
  assert.ok(actions.includes('flexShrink: 0'))
  for (const f of ['src/screens/SonglistDetail/ActionBar.tsx','src/screens/Home/Views/Leaderboard/MusicList.tsx'])
    assert.ok(source(f).includes('<ListActionBar'),f)
})
check('bottom navigation default remains visible and toggle takes effect immediately', () => {
  const defaults = load('src/config/defaultSetting.ts').default
  assert.equal(defaults['common.hidePortraitNavigation'],false)
  assert.equal(layout.showBottomNavigation(false),true)
  assert.equal(layout.showBottomNavigation(true),false)
  const tab = source('src/screens/Home/Vertical/NavigationTabs.tsx')
  assert.ok(tab.includes("useSettingValue('common.hidePortraitNavigation')"))
  assert.ok(tab.includes('if (!showBottomNavigation(hidden)) return null'))
  assert.ok(source('src/screens/Home/Vertical/Header.tsx').includes('onPress={openMenu}'))
})
check('saved navigation preference merges on cold configuration load', () => {
  const defaults = load('src/config/defaultSetting.ts').default
  const configMocks = { '@/config/constant': {}, '@/config/defaultSetting': {default: defaults}, '@/plugins/storage': {},
    './migrateSetting': {}, '@/store/setting/state': {default:{setting:defaults}}, './migrate':{}, '@/utils/tools':{} }
  const config = load('src/config/setting.ts',configMocks)
  const saved = JSON.parse(JSON.stringify({...defaults,'common.hidePortraitNavigation':true}))
  const restored = config.updateSetting(saved,true)
  assert.equal(restored.setting['common.hidePortraitNavigation'],true)
  assert.equal(config.updateSetting({...saved,'common.hidePortraitNavigation':false},true).setting['common.hidePortraitNavigation'],false)
})
check('Build81 change log and production screenshot phases are committed', () => {
  assert.ok(source('CHANGELOG.md').includes('1.8.2 Build 81'))
  const shell = source('scripts/run-ios-playback-smoke.sh')
  assert.ok(shell.includes('tablet tabletportrait phone'))
  assert.ok(shell.includes('table favorites list settings menu navhidden'))
  assert.ok(shell.includes('Native playback records and 54 production-view screenshots'))
})
console.log(`${count} Build 81 regression checks passed; native playback and UI screenshots run separately in Actions.`)
