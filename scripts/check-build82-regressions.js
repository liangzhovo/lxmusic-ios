// Executable rendering/policy checks. Native scene/status-bar behavior is also
// exercised by the Release simulator job, not inferred from these source checks.
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript')
const cp = require('node:child_process')
const root = path.resolve(__dirname, '..')
const source = file => fs.readFileSync(path.join(root, file), 'utf8')
const jsx = (type, props) => ({ type, props })
const runtime = { jsx, jsxs: jsx, Fragment: 'Fragment' }
const native = { View: 'View', ScrollView: 'ScrollView', TouchableHighlight: 'TouchableHighlight',
  StyleSheet: { create: x => x }, PixelRatio: { getFontScale: () => 1 }, Platform: { OS: 'ios' } }
const load = (file, mocks = {}) => {
  const result = ts.transpileModule(source(file), { fileName: file, reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } })
  assert.equal((result.diagnostics || []).filter(d => d.category === 1).length, 0, file)
  const exports = {}
  vm.runInNewContext(result.outputText, { exports, console, setTimeout, clearTimeout, Set,
    require: name => { assert.ok(name in mocks, `Missing mock: ${name} in ${file}`); return mocks[name] } })
  return exports
}
const plain = x => JSON.parse(JSON.stringify(x))
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object'
  ? [tree, ...nodes(tree.props?.children)] : []
const textOf = tree => Array.isArray(tree) ? tree.map(textOf).join('') : tree && typeof tree === 'object'
  ? textOf(tree.props?.children) : tree ?? ''
let count = 0
const check = (name, test) => { test(); count++; console.log(`PASS ${name}`) }
const layout = load('src/utils/songLayout.ts')
const readability = load('src/utils/readability.ts')
const overlay = load('src/utils/overlaySurface.ts', { './readability': readability })
const menus = load('src/utils/menuLayout.ts')
let wide = true, dark = false, measured = 900
const theme = () => ({ isDark: dark, 'c-font': dark ? '#ddd' : '#222', 'c-font-label': dark ? '#aaa' : '#555',
  'c-primary-font': '#347fad', 'c-content-background': dark ? '#141414' : '#fff', 'c-border-background': '#666' })
const rowMocks = { 'react/jsx-runtime': runtime, react: { useState: () => [measured, () => {}] },
  'react-native': native, './Text': { default: 'Text' }, '@/utils/hooks': { useHorizontalMode: () => wide },
  '@/store/theme/hook': { useTheme: theme }, '@/utils/songLayout': layout, '@/utils/selectionColors': load('src/utils/selectionColors.ts'), '@/utils/playingColor': load('src/utils/playingColor.ts', { './readability': load('src/utils/readability.ts') }) }
const Row = load('src/components/common/SongRowContent.tsx', rowMocks).default
const Header = load('src/components/common/SongTableHeader.tsx', { ...rowMocks, './SongRowContent': { default: Row } }).default
check('source is a nonshrinking badge next to song title in both layouts/themes', () => {
  for (wide of [true, false]) for (dark of [true, false]) for (const src of ['kw', 'wy', 'kg', 'tx', 'mg']) {
    const tree = Row({ name: '非常长的歌曲名称'.repeat(12), singer: '歌手', source: src, interval: '05:01' })
    const badges = nodes(tree).filter(n => n.props?.testID === 'song-source')
    assert.equal(badges.length, 1); assert.equal(textOf(badges[0]), src)
    assert.equal(badges[0].props.style.flexShrink, 0)
    const titleRow = nodes(tree).find(n => n.props?.children?.includes?.(badges[0]))
    assert.equal(titleRow.props.style.alignItems, 'baseline')
    assert.ok(titleRow.props.children[0].props.style.flexShrink > 0)
  }
})
check('headers omit source tags and portrait column headings', () => {
  wide = false; assert.equal(Header({}), null)
  assert.equal(Row({ name: '歌曲名', singer: '艺术家', header: true }), null)
  wide = true
  assert.equal(nodes(Row({ name: '歌曲名', singer: '艺术家', source: 'kw', header: true })).filter(n => n.props?.testID === 'song-source').length, 0)
})
check('dark and light table backgrounds inherit the actual page without grey fill', () => {
  wide = true
  for (dark of [true, false]) {
    const h = Header({})
    assert.equal(h.props.style.backgroundColor, 'transparent')
    assert.equal(h.props.style.borderBottomWidth, 1)
  }
})
check('duration heading and data share the same center, width and action gap', () => {
  wide = true
  for (measured of [450, 620, 900, 1300]) {
    const data = Row({ name: 'song', singer: 'artist', interval: '04:30' })
    const heading = Row({ name: '歌曲名', singer: '艺术家', interval: '时长', header: true })
    const cell = t => nodes(t).find(n => n.type === 'Text' && (textOf(n) === '04:30' || textOf(n) === '时长'))
    const ds = cell(data).props.style[0], hs = cell(heading).props.style[0]
    assert.deepEqual(plain(ds), plain(hs)); assert.equal(ds.textAlign, 'center')
    assert.equal(ds.width, layout.SONG_TIME_WIDTH)
    assert.equal(data.props.style.paddingRight, layout.SONG_TRAILING_GAP)
    assert.ok(data.props.style.paddingRight >= 12)
  }
})
check('online sources do not disappear behind the old showSource prop', () => {
  const file = source('src/components/OnlineList/ListItem.tsx')
  assert.ok(file.includes('source={item.source}'))
  assert.ok(!file.includes('source={showSource ? item.source'))
  for (const file of ['src/screens/Home/Views/Mylist/MusicList/ListItem.tsx',
    'src/screens/PlayDetail/Horizontal/components/PlaylistBtn.tsx']) assert.ok(source(file).includes('source='), file)
})
check('menu width estimates complete localized labels and respects larger type', () => {
  assert.equal(menus.displayMenuLabel('添加到...'), '添加到列表')
  assert.equal(menus.displayMenuLabel('移动到…'), '移动到列表')
  assert.equal(menus.displayMenuLabel('歌曲详细信息'), '歌曲详细信息')
  for (const label of ['歌曲详细信息', '将歌曲添加到其他收藏列表', 'Add to another collection', '移動到其他播放清單']) {
    for (const scale of [1, 1.3, 1.8, 2.5]) {
      const m = menus.menuMetrics([label], 17 * scale)
      assert.ok(m.width >= menus.estimateLabelWidth(label, 17 * scale) + 36)
      assert.ok(m.rowHeight >= 44 && m.rowHeight >= 17 * scale + 20)
    }
  }
})
check('full menu labels remain rendered without ellipsis at constrained widths', () => {
  const Menu = load('src/components/common/Menu.tsx', {
    'react/jsx-runtime': runtime, react: { forwardRef: f => f, useRef: () => ({ current: null }),
      useState: x => [x, () => {}], useImperativeHandle: () => {} }, 'react-native': native,
    '@/utils/overlaySurface': overlay, '@/utils/menuLayout': menus,
    '@/utils/selectionColors': load('src/utils/selectionColors.ts'), '@/utils/playingColor': load('src/utils/playingColor.ts', { './readability': load('src/utils/readability.ts') }), '@/utils/hooks/useSongKeyboard': { default: () => null },
    '@/utils/hooks': { useWindowSize: () => ({ width: 320, height: 400 }) },
    '@/store/theme/hook': { useTheme: theme }, './Text': { default: 'Text' }, './Modal': { default: 'Modal' },
    '@/utils/pixelRatio': { setSpText: n => n + 2 },
  }).default
  const labels = ['播放', '添加到...', '歌曲详细信息', '将歌曲添加到其他收藏列表']
  const shell = Menu({ menus: labels.map((label, i) => ({ label, action: String(i) })), onPress: () => {} }, {})
  const child = shell.props.children
  const tree = child.type(child.props)
  const items = nodes(tree).filter(n => n.type === 'TouchableHighlight')
  assert.equal(items.length, labels.length)
  for (let i = 0; i < items.length; i++) {
    assert.equal(textOf(items[i]), menus.displayMenuLabel(labels[i]))
    assert.equal(items[i].props.children.props.numberOfLines, undefined)
  }
  assert.equal(shell.props.bgColor, 'transparent')
})
check('shadow-only menus keep a transparent outside-tap layer in either theme', () => {
  assert.equal(overlay.OVERLAY_BACKDROP, 'transparent')
  for (dark of [false, true]) {
    const surface = overlay.overlaySurface(theme())
    assert.ok(surface.shadowRadius >= 12 && surface.shadowOpacity >= .25 && surface.borderWidth >= 1)
  }
  assert.ok(source('src/components/common/Modal.tsx').includes('bgColor = OVERLAY_BACKDROP'))
  assert.ok(source('src/components/common/DorpDownPanel/Panel.tsx').includes('overlaySurface(theme)'))
})
check('long menu content clamps/scrolls inside all viewport edges', () => {
  for (const [width,height] of [[1366,1000],[700,500],[390,844],[320,220],[150,120]]) {
    const preferred = menus.menuMetrics(['将歌曲添加到其他收藏列表'], 34)
    const r = overlay.anchoredMenuBounds(width,height,{x:width-30,y:height/2,w:30,h:44}, preferred.width, 1000)
    assert.ok(r.width <= width && r.height < 1000)
    assert.ok(r.left >= 0 && r.top >= 0 && r.left+r.width <= width && r.top+r.height <= height)
  }
})
check('live theme updates cover existing controllers, new screens and native windows', () => {
  const calls = [], state = { componentIds: { home: 'HOME', detail: 'DETAIL', duplicate: 'HOME', empty: '' } }
  const mod = load('src/navigation/appearance.ts', {
    'react-native': { Platform: { OS: 'ios' }, StatusBar: { setBarStyle: (...args) => calls.push(['rn', ...args]) },
      NativeModules: { LXWindowAppearance: { setDark: dark => calls.push(['native', dark]) } } },
    'react-native-navigation': { Navigation: { setDefaultOptions: o => calls.push(['default', o]), mergeOptions: (id,o) => calls.push(['merge',id,o]) } },
    '@/store/common/state': { default: state },
  })
  for (const isDark of [false,true,false]) {
    calls.length = 0; mod.applyNavigationAppearance(isDark)
    assert.equal(calls.filter(c => c[0] === 'merge').length, 2)
    assert.ok(calls.find(c => c[0] === 'merge' && c[1] === 'DETAIL'))
    assert.equal(calls.find(c => c[0] === 'default')[1].statusBar.style, isDark ? 'light' : 'dark')
    assert.deepEqual(calls.find(c => c[0] === 'native'), ['native', isDark])
    assert.equal(calls.find(c => c[0] === 'rn')[1], isDark ? 'light-content' : 'dark-content')
  }
})
check('landscape library/chart omit the generic duplicate header row', () => {
  let id = 'nav_love'
  const Header = load('src/screens/Home/Horizontal/Header.tsx', {
    'react/jsx-runtime': runtime, 'react-native': native,
    '@/store/common/hook': { useNavActiveId: () => id, useStatusbarHeight: () => 0 },
    '@/lang': { useI18n: () => x => x }, '@/utils/tools': { createStyle: x => x },
    '@/components/common/Text': { default: 'Text' }, '@/components/common/StatusBar': { default: 'StatusBar' },
    '@/store/setting/hook': { useSettingValue: () => 'left' }, '@/utils/pixelRatio': { scaleSizeH: x => x },
    '@/config/constant': { HEADER_HEIGHT: 44 }, '@/screens/Home/Views/Search/SearchTypeSelector': { default: 'SearchTypeSelector' },
  }).default
  for (id of ['nav_love','nav_top']) assert.equal(Header().type, 'StatusBar')
  id = 'nav_search'; assert.equal(Header().type, 'Fragment')
  // The sidebar still owns the list name; the toolbar now exposes locate-playing.
  require('./check-mylist-location').assertSidebarLibraryToolbar()
})
check('scene-owned window is installed before the single RNN bridge starts', () => {
  const native = source('ios/LxMusicMobile/AppDelegate.mm')
  const launch = native.slice(native.indexOf('- (BOOL)application:(UIApplication *)application didFinishLaunching'), native.indexOf('- (void)startReactNativeWithLaunchOptions'))
  assert.ok(!launch.includes('RCTBridge *bridge'))
  const scene = native.slice(native.indexOf('@implementation LXSceneDelegate'))
  assert.ok(scene.indexOf('app.window = self.window') < scene.indexOf('[app startReactNativeWithLaunchOptions'))
  assert.ok(scene.includes('preferredWindowingControlStyleForScene:'))
  assert.ok(scene.includes('return UISceneWindowingControlStyle.minimalStyle'))
  assert.ok(native.includes('if ([ReactNativeNavigation getBridge] != nil) return'))
  assert.ok(scene.includes('[RCTLinkingManager application:'))
  const plist = source('ios/LxMusicMobile/Info.plist')
  assert.match(plist, /<key>UIApplicationSupportsMultipleScenes<\/key>\s*<false\/>/)
  assert.ok(plist.includes('<string>LXSceneDelegate</string>'))
})
check('native content only consumes its own remaining vertical occlusion', () => {
  const swift = source('ios/LxMusicMobile/LXWindowInsets.swift')
  assert.ok(swift.includes('var insets = self.safeAreaInsets'))
  assert.ok(swift.includes('self.edgeInsets(for: .safeArea(cornerAdaptation: .vertical))'))
  assert.ok(!swift.includes('window.convert('))
  assert.ok(!source('src/components/WindowContent.tsx').includes('IPAD_CONTROL_STRIP_HEIGHT = 36'))
})
check('release simulator validates scene style, live status colors and production themes', () => {
  const ui = source('src/tests/uiSmoke.tsx')
  assert.ok(ui.includes('<Provider><Fixture /></Provider>'))
  assert.ok(ui.includes('support.windowSnapshot()'))
  assert.ok(ui.includes('native.sceneAttached && native.minimalWindowControls && styleOK'))
  assert.ok(source('src/tests/playbackSmoke.tsx').includes('scene-based window and minimal native window controls'))
  const script = source('scripts/run-ios-playback-smoke.sh')
  for (const phase of ['darktable','darkmenu','darklibrary','themeswitch','lightagain']) assert.ok(script.includes(phase))
  assert.ok(script.includes('54 production-view screenshots'))
})
check('Build82 version and seven-fix changelog ship with regression gates', () => {
  assert.ok(JSON.parse(source('package.json')).versionCode >= 82)
  assert.ok(source('CHANGELOG.md').includes('1.8.2 Build 82'))
  assert.ok(source('.github/workflows/ios-ipa.yml').includes('node scripts/check-build82-regressions.js'))
  assert.ok(source('.github/workflows/ios-ipa.yml').includes('run-ios-playback-smoke.sh'))
})
console.log(`${count} Build 82 checks passed; native scene, audio and UI validation are separate Actions gates.`)
