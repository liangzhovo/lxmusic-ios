// Build86: background contrast is not sufficient to distinguish playing text.
// Test the rendered row props as well as colour distance, chroma and upstream
// background ownership. Runtime screenshots are a separate mandatory CI step.
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript')
const root = path.resolve(__dirname, '..'), read = p => fs.readFileSync(path.join(root, p), 'utf8')
const load = (file, mocks = {}) => {
  const result = ts.transpileModule(read(file), { fileName: file, reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } })
  assert.equal((result.diagnostics || []).filter(d => d.category === 1).length, 0, file)
  const exports = {}; vm.runInNewContext(result.outputText, { exports, require: name => {
    assert.ok(name in mocks, `${file}: missing dependency ${name}`); return mocks[name]
  } }, { filename: file }); return exports
}
const plain = v => JSON.parse(JSON.stringify(v))
const readability = load('src/utils/readability.ts')
const colours = load('src/utils/playingColor.ts', { './readability': readability })
const themeAccent = load('src/utils/themeAccent.ts', { './readability': readability, './playingColor': colours })
const overlay = load('src/utils/overlaySurface.ts', { './readability': readability })
const themes = load('src/theme/themes/themes.ts').default
const palette = item => {
  const t = { isDark: item.isDark, ...item.config.themeColors }
  for (const [k, v] of Object.entries(item.config.extInfo)) t[k] = typeof v === 'string' && v.startsWith('var(') ? t[v.slice(4, -1)] : v
  return themeAccent.readableThemeWithAccent({ ...t, 'c-content-background': t['c-primary-light-1000'],
    'c-primary-font': t['c-primary'], 'c-font': t['c-850'], 'c-font-label': t['c-450'],
    'c-button-font': t['c-primary'], 'c-button-background': t['c-primary-light-400-alpha-700'] })
}
const hue = value => {
  const [r, g, b] = value.match(/[\d.]+/g).map(Number), high = Math.max(r, g, b), low = Math.min(r, g, b), d = high - low
  if (!d) return 0
  return ((high === r ? (g - b) / d : high === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60 + 360) % 360
}
const hueDistance = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b))
let checks = 0
const check = (name, fn) => { fn(); checks++; console.log('PASS ' + name) }
const evidence = []
const checkForeground = (theme, surface, label) => {
  const bg = colours.songSurface(theme, surface), c = colours.playingColor(theme, surface)
  const contrast = readability.contrastRatio(c, bg), chroma = colours.playingColorChroma(c, bg)
  const normalDistance = colours.playingColorDistance(c, theme['c-font'], bg)
  const secondaryDistance = colours.playingColorDistance(c, theme['c-font-label'] || theme['c-font'], bg)
  assert.ok(contrast >= 4.8, label + ': unreadable on surface')
  assert.ok(chroma >= .085 && chroma <= .18, label + ': grey/white/black or excessive chroma')
  assert.ok(normalDistance >= .16, label + ': merges with normal song title')
  assert.ok(secondaryDistance >= .10, label + ': merges with secondary metadata')
  evidence.push({ label, background: bg, normal: theme['c-font'], secondary: theme['c-font-label'], playing: c, contrast, chroma, normalDistance, secondaryDistance })
  return c
}
check('perceptual metric reference vectors distinguish white, black and red', () => {
  assert.ok(colours.playingColorDistance('#fff', '#000', '#fff') > .999)
  assert.ok(colours.playingColorChroma('#fff', '#fff') < .00001)
  assert.ok(Math.abs(colours.playingColorChroma('#ff0000', '#fff') - .25768) < .0001)
})
check('all shipped themes: page AND popup, using the actual iOS readability transform', () => {
  for (const item of themes) {
    const t = palette(item)
    checkForeground(t, undefined, item.id + ':page')
    checkForeground(t, overlay.overlaySurface(t).backgroundColor, item.id + ':popup')
  }
})
check('neutral dark themes cannot select white/grey despite their high background contrast', () => {
  for (const bg of ['#000000', '#151515', '#313131']) {
    const t = { isDark: true, 'c-content-background': bg, 'c-primary': '#bcbcbc', 'c-font': '#eeeeee', 'c-font-label': '#999999' }
    checkForeground(t, undefined, 'neutral-dark:' + bg)
  }
})
check('light themes cannot darken playing titles until they merge with ordinary black text', () => {
  for (const accent of ['#888888', '#24698a', '#d78231', '#a966b5', '#43a170']) {
    const t = { isDark: false, 'c-content-background': '#ffffff', 'c-primary': accent, 'c-font': '#222222', 'c-font-label': '#777777' }
    checkForeground(t, undefined, 'light-custom:' + accent)
  }
})
check('standard coloured themes keep their hue instead of all becoming blue', () => {
  const results = new Set()
  for (const id of ['green', 'blue', 'orange', 'red', 'pink', 'purple', 'brown', 'blue_plus']) {
    const t = palette(themes.find(x => x.id === id)), c = colours.playingColor(t)
    assert.ok(hueDistance(hue(c), hue(readability.compositeColor(t['c-primary'], '#fff'))) < 16, id)
    results.add(c)
  }
  assert.equal(results.size, 8)
})
check('custom coloured body text forces a different accent rather than a same-colour active row', () => {
  const t = { isDark: false, 'c-content-background': '#ffffff', 'c-primary': '#2b75a5', 'c-font': '#2b75a5', 'c-font-label': '#2b75a5' }
  checkForeground(t, undefined, 'same-accent-and-text')
})
check('transparent surfaces and changing themes do not reuse stale foreground colours', () => {
  const t = { isDark: false, 'c-content-background': '#ffffff', 'c-primary': '#73808b', 'c-font': '#333333', 'c-font-label': '#777777' }
  const a = checkForeground(t, 'rgba(0,0,0,0.03)', 'alpha-light')
  Object.assign(t, { isDark: true, 'c-content-background': '#161616', 'c-font': '#eeeeee', 'c-font-label': '#999999' })
  const b = checkForeground(t, 'rgba(255,255,255,0.04)', 'alpha-dark')
  assert.notEqual(a, b)
})
check('sidebar/navigation and list-name headings no longer have the added selection slabs or stripes', () => {
  for (const file of ['src/screens/Home/Horizontal/Aside.tsx', 'src/screens/Home/Vertical/NavigationTabs.tsx', 'src/screens/Home/Views/Mylist/MyList/List.tsx']) {
    const s = read(file)
    assert.ok(!s.includes('selectionColors'), file)
    assert.ok(!/backgroundColor:.*(?:active|selected)/i.test(s), file)
    assert.ok(!s.includes('borderLeftWidth: 3') && !s.includes('borderTopWidth: 3'), file)
  }
  assert.ok(read('src/screens/Home/Views/Mylist/MyList/List.tsx').includes('name="chevron-right"'))
})
check('table headings retain transparent background and existing column geometry', () => {
  const s = read('src/components/common/SongTableHeader.tsx')
  assert.ok(s.includes("backgroundColor: 'transparent'"))
  assert.ok(s.includes('if (!horizontal) return null'))
  assert.ok(s.includes('SONG_ACTION_WIDTH') && s.includes('SONG_NUMBER_WIDTH'))
})
check('menu active item returns to upstream text emphasis; keyboard focus does not fill the menu row', () => {
  const s = read('src/components/common/Menu.tsx')
  assert.ok(!s.includes('selectionColors'))
  assert.ok(s.includes("backgroundColor: 'transparent'"))
  assert.ok(s.includes("? theme['c-primary-font'] : theme['c-font']"))
  assert.ok(s.includes('borderWidth: 1') && s.includes('menu.action == focused'))
  assert.ok(s.includes('overlaySurface(theme)') && s.includes('bgColor="transparent"'))
})
check('original multi-selection fill is retained, but its hard-coded replacement palette is gone', () => {
  const selection = load('src/utils/selectionColors.ts').selectionColors
  const t = { isDark: false, 'c-primary-background-hover': 'rgba(55,140,80,0.18)', 'c-font': '#454545', 'c-primary-font': '#26854a', 'c-border-background': '#ddd' }
  assert.deepEqual(plain(selection(t)), { background: t['c-primary-background-hover'], text: t['c-font'], indicator: t['c-primary-font'], border: t['c-border-background'] })
  for (const file of ['src/components/OnlineList/ListItem.tsx', 'src/screens/Home/Views/Mylist/MusicList/ListItem.tsx']) {
    const s = read(file)
    assert.ok(s.includes("backgroundColor: isSelected ? selection.background : 'transparent'"))
    assert.ok(!s.includes('active || isSelected') && !s.includes('active || focused'))
  }
})
check('real SongRowContent render applies one chromatic playing colour to every column, with regular weight and no fill', () => {
  const layout = load('src/utils/songLayout.ts'), selected = load('src/utils/selectionColors.ts')
  const jsx = (type, props) => ({ type, props })
  for (const id of ['green', 'black', 'grey', 'purple']) {
    const theme = palette(themes.find(t => t.id === id))
    const Row = load('src/components/common/SongRowContent.tsx', { '@/utils/playingColor': colours, '@/utils/selectionColors': selected,
      react: { useState: () => [900, () => {}] }, 'react/jsx-runtime': { jsx, jsxs: jsx },
      'react-native': { View: 'View', StyleSheet: { create: x => x } }, './Text': { default: 'Text' },
      '@/store/theme/hook': { useTheme: () => theme }, '@/utils/hooks': { useHorizontalMode: () => true }, '@/utils/songLayout': layout }).default
    const flatten = n => !n || typeof n !== 'object' ? [] : [n, ...[n.props?.children].flat(Infinity).flatMap(flatten)]
    const props = { name: '当前歌曲', singer: '歌手', album: '专辑', source: 'wy', interval: '04:32' }
    const playing = flatten(Row({ ...props, active: true })), normal = flatten(Row(props))
    const c = colours.playingColor(theme)
    for (const node of playing.filter(n => n.type === 'Text')) assert.equal(node.props.color, c, id)
    for (const node of playing) for (const style of [node.props.style].flat(Infinity).filter(Boolean)) {
      assert.ok(!style.backgroundColor); assert.ok(!style.borderLeftWidth); assert.ok(!style.fontWeight || style.fontWeight === '400')
    }
    assert.notEqual(normal.find(n => n.type === 'Text').props.color, c)
    assert.ok(playing.some(n => n.props.testID === 'song-source'))
  }
})
check('queue auto-location/manual location and non-colour playback marker remain available', () => {
  const s = read('src/screens/PlayDetail/Horizontal/components/PlaylistBtn.tsx')
  assert.ok(s.includes('scrollToIndex') && s.includes('requestAnimationFrame(locate)'))
  assert.ok(s.includes('accessibilityLabel="定位正在播放的歌曲"') && s.includes('name="play-outline"'))
  assert.ok(s.includes("backgroundColor: 'transparent'"))
})
check('runtime screenshots expose a visible active row on table views, not only an offscreen row 66', () => {
  const s = read('src/tests/uiSmoke.tsx')
  assert.ok(s.includes("songs[phase == 'list' || phase == 'library' ? 65 : 3]"))
  assert.ok(s.includes('normalDistance') && s.includes('secondaryDistance') && s.includes('colourOK'))
  assert.ok(read('scripts/run-ios-playback-smoke.sh').includes('54 production-view screenshots'))
})
check('build identity and unchanged audio/auth/scene fingerprints; catalog repair has its own behavioral gate', () => {
  assert.equal(JSON.parse(read('package.json')).versionCode, 88)
  assert.ok(read('CHANGELOG.md').includes('iOS / iPadOS 1.9.0 Build 86'))
  assert.ok(read('src/plugins/sync/listEvent.ts').includes('global.list_event.list_data_snapshot()'))
  assert.ok(read('.github/workflows/ios-ipa.yml').includes('node scripts/check-sync-catalog-race.js'))
  const audit = JSON.parse(read('docs/BUILD86_BASELINE_HASHES.json'))
  const hash = require('node:crypto').createHash
  for (const [file, sha] of Object.entries(audit)) assert.equal(hash('sha256').update(file === 'ios/LxMusicMobile/AppDelegate.mm' ? require('./native-build88-preservation').legacyNativeSource(read(file)) : read(file)).digest('hex'), sha, file)
})
fs.mkdirSync(path.join(root, 'build/checks'), { recursive: true })
fs.writeFileSync(path.join(root, 'build/checks/build86-colours.json'), JSON.stringify(evidence, null, 2))
console.log(`${checks} Build86 regression groups passed; ${evidence.length} foreground/surface pairs recorded. Native screenshots and device build run separately.`)


// Shared title/navigation/menu emphasis must pass, not only playing rows.
require('./check-theme-accent')
