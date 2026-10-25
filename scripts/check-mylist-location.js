// Runs production components/handlers with deterministic platform and storage adapters.
// These checks do not replace the native simulator or physical-device UI checks.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { EventEmitter } = require('node:events')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const base = 'src/screens/Home/Views/Mylist/MusicList/'
const source = file => fs.readFileSync(path.join(root, file), 'utf8')
const plain = value => JSON.parse(JSON.stringify(value))
const jsx = (type, props) => ({ type, props })
const runtime = { jsx, jsxs: jsx, Fragment: 'Fragment' }
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object'
  ? [tree, ...nodes(tree.props?.children)] : []
const textOf = tree => Array.isArray(tree) ? tree.map(textOf).join('') : tree && typeof tree === 'object'
  ? textOf(tree.props?.children) : typeof tree === 'string' ? tree : ''
const load = (file, mocks = {}, extras = {}) => {
  const result = ts.transpileModule(source(file), { fileName: file, reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } })
  assert.equal((result.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0, file)
  const exports = {}
  vm.runInNewContext(result.outputText, { exports, console, setTimeout, clearTimeout,
    require: name => { assert.ok(Object.hasOwn(mocks, name), `Unexpected dependency ${name} in ${file}`); return mocks[name] },
    ...extras }, { filename: file })
  return exports
}
const ids = { TEMP: 'temp', DEFAULT: 'default', LOVE: 'love' }
function toolbarFixture() {
  const state = { horizontal: true, os: 'ios', visible: true, fetching: false, id: 'A',
    locate: 0, search: 0, drawer: 0 }
  const ref = { current: null }
  const native = { View: 'View', TouchableOpacity: 'TouchableOpacity', Platform: { get OS() { return state.os } } }
  const ActiveList = load(base + 'ActiveList.tsx', {
    react: { forwardRef: f => f, useMemo: f => f(), useState: initial => [state.visible, v => { state.visible = v }],
      useImperativeHandle: (target, make) => { target.current = make() } },
    'react/jsx-runtime': runtime, 'react-native': native,
    '@/components/common/Icon': { Icon: 'Icon' }, '@/theme': { BorderWidths: { normal: 1 } },
    '@/store/theme/hook': { useTheme: () => ({ 'c-border-background': '#555', 'c-button-font': '#ddd' }) },
    '@/store/list/hook': { useActiveListId: () => state.id, useListFetching: () => state.fetching,
      useMyList: () => [{ id: 'A', name: 'My collection' }] },
    '@/utils/tools': { createStyle: value => value }, '@/components/common/Text': { default: 'Text' },
    '@/components/common/Loading': { default: 'Loading' }, '@/config/constant': { LIST_IDS: ids },
    '@/utils/hooks': { useHorizontalMode: () => state.horizontal }, '@/store/setting/hook': { useSettingValue: () => 'zh' },
  }, { global: { i18n: { t: key => key }, app_event: { changeLoveListVisible: visible => {
    assert.equal(visible, true); state.drawer++
  } } } }).default
  return { state, ref, render: props => ActiveList({ onLocatePlaying: () => state.locate++,
    onShowSearchBar: () => state.search++, ...props }, ref) }
}
function assertCompactLibraryToolbar() {
  const f = toolbarFixture()
  f.state.horizontal = false
  const selector = jsx('Selector', { children: 'My collection' })
  const render = () => f.render({ listSelector: selector })
  const tree = render()
  assert.equal(tree.type, 'View')
  assert.equal(tree.props.testID, 'compact-library-toolbar')
  assert.equal(nodes(tree).filter(n => n === selector).length, 1)
  assert.equal(nodes(tree).filter(n => n.type === 'Text').length, 0, 'No second list-title row')
  assert.equal(tree.props.style.height, 48)
  const buttons = nodes(tree).filter(n => n.type === 'TouchableOpacity')
  assert.equal(buttons.length, 2)
  assert.deepEqual(buttons.map(n => n.props.accessibilityLabel), ['定位当前播放歌曲', '搜索当前列表'])
  for (const button of buttons) assert.equal(button.props.accessibilityRole, 'button')
  buttons[0].props.onPress()
  assert.equal(f.state.locate, 1)
  assert.equal(f.state.search, 0)
  buttons[1].props.onPress()
  assert.equal(f.state.search, 1)
  assert.equal(f.state.locate, 1, 'Search must not call locate')
  f.state.fetching = true
  assert.equal(nodes(render()).filter(n => n.type === 'Loading').length, 1)
  f.ref.current.setVisibleBar(false)
  assert.equal(render().props.pointerEvents, 'none')
  assert.equal(render().props.style.opacity, 0)
  f.ref.current.setVisibleBar(true)
  assert.equal(render().props.pointerEvents, 'auto')
  assert.equal(render().props.style.opacity, 1)
}
function assertSidebarLibraryToolbar() {
  const f = toolbarFixture()
  const tree = f.render()
  assert.equal(tree.type, 'TouchableOpacity')
  assert.equal(tree.props.accessibilityRole, 'button')
  assert.equal(tree.props.accessibilityLabel, '定位当前播放歌曲')
  assert.equal(textOf(tree), '定位当前播放歌曲', 'Sidebar owns the list name; the toolbar owns the locate action')
  assert.equal(nodes(tree).filter(n => n.props?.testID === 'library-locate-playing').length, 1)
  tree.props.onPress(); tree.props.onLongPress()
  assert.equal(f.state.locate, 2)
  assert.equal(f.state.drawer, 0)
  const search = nodes(tree).find(n => n !== tree && n.type === 'TouchableOpacity')
  assert.ok(search)
  search.props.onPress()
  assert.equal(f.state.search, 1)
  assert.equal(f.state.locate, 2)
  f.state.horizontal = false
  assert.equal(textOf(f.render()), 'My collection', 'Non-sidebar layout keeps its current list title')
  f.state.horizontal = true
  assert.equal(textOf(f.render()), '定位当前播放歌曲', 'Layout changes are reflected without restart')
  f.state.os = 'android'
  f.render().props.onPress()
  assert.equal(f.state.drawer, 1, 'Android drawer behavior is retained')
  assert.equal(f.state.locate, 2)
}
function parentLocateCallback(appEvent, listState) {
  const defaultMocks = {}
  for (const name of ['./ListMenu', './List', '@/components/MusicAddModal', '@/components/MusicMultiAddModal',
    './ActiveList', './MultipleModeBar', './ListSearchBar', './ListMusicSearch', './MusicPositionModal',
    '@/components/MetadataEditModal', './MusicToggleModal']) defaultMocks[name] = { default: name }
  const Parent = load(base + 'index.tsx', {
    ...defaultMocks, react: { useRef: initial => ({ current: initial }), useCallback: f => f },
    'react/jsx-runtime': runtime, 'react-native': { View: 'View' },
    '@/store/list/state': { default: listState }, './listAction': {}, '@/utils/tools': { createStyle: x => x },
  }, { global: { app_event: appEvent } }).default
  const active = nodes(Parent({})).filter(n => n.type === './ActiveList')
  assert.equal(active.length, 1)
  assert.equal(typeof active[0].props.onLocatePlaying, 'function')
  return active[0].props.onLocatePlaying
}
const settle = async() => { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)) }
function mountedListFixture() {
  const app = new EventEmitter(), events = new EventEmitter(), effects = [], frames = []
  app.jumpListPosition = () => app.emit('jumpListPosition')
  const songs = { A: [{ id: 'other' }, { id: 'target' }], B: [{ id: 'target' }] }
  const list = { activeListId: 'A', allList: [{ id: 'A' }, { id: 'B' }] }
  // Deliberately wrong queue index: only the song ID is authoritative for the library.
  const player = { playMusicInfo: { listId: 'A', musicInfo: { id: 'target' } }, playInfo: { playIndex: 999 } }
  const calls = { index: [], offset: [], active: [], toast: [], playback: 0 }
  let read = async id => songs[id] || []
  const resolver = load('src/core/listLocation.ts')
  const List = load(base + 'List.tsx', {
    react: { forwardRef: f => f, useRef: initial => ({ current: initial }), useMemo: f => f(),
      useState: initial => [initial, () => {}], useEffect: f => effects.push(f), useImperativeHandle: () => {} },
    'react/jsx-runtime': runtime, 'react-native': { View: 'View', FlatList: 'FlatList', Platform: { OS: 'ios' } },
    '@/config/constant': { LIST_IDS: ids }, '@/utils/hooks/useSongKeyboard': { default: () => undefined },
    '@/components/common/SongTableHeader': { default: 'SongTableHeader' },
    '@/core/player/player': { playList: () => { calls.playback++; throw Error('Locating must not start playback') } },
    '@/core/listLocation': resolver, '@/store/list/state': { default: list }, '@/store/player/state': { default: player },
    '@/utils/data': { getListPosition: async() => 17, getListPrevSelectId: async() => 'A', saveListPosition: async() => {} },
    '@/core/list': { getListMusics: id => read(id), setActiveList: id => { calls.active.push(id); list.activeListId = id; events.emit('mylistToggled', id) } },
    './ListItem': { default: 'ListItem', ITEM_HEIGHT: 50 },
    '@/utils/tools': { createStyle: x => x, getRowInfo: () => ({ rowNum: 1 }), toast: msg => calls.toast.push(msg) },
    '@/store/player/hook': { usePlayInfo: () => player.playInfo, usePlayMusicInfo: () => player.playMusicInfo },
    '@/store/list/hook': { useActiveListId: () => list.activeListId }, '@/store/setting/hook': { useSettingValue: () => true },
  }, { global: { lx: { jumpMyListPosition: false, homePagerIdle: true }, app_event: app, state_event: events },
    requestAnimationFrame: callback => { frames.push(callback); return frames.length } }).default
  const tree = List({ onShowMenu() {}, onMuiltSelectMode() {}, onSelectAll() {} }, {})
  const flat = nodes(tree).find(n => n.type === 'FlatList')
  assert.ok(flat)
  flat.props.ref.current = { scrollToIndex: options => calls.index.push(plain(options)),
    scrollToOffset: options => calls.offset.push(plain(options)) }
  const cleanups = effects.map(f => f())
  const locate = parentLocateCallback(app, list)
  const toolbar = toolbarFixture()
  const click = () => toolbar.render({ onLocatePlaying: locate }).props.onPress()
  return { songs, list, player, calls, app, events, click,
    setRead(fn) { read = fn },
    async flush() { for (let i = 0; i < 6; i++) { await settle(); while (frames.length) frames.shift()() } },
    unmount() { for (const cleanup of cleanups) if (typeof cleanup === 'function') cleanup() } }
}
async function run() {
  let count = 0
  const check = async(name, fn) => { await fn(); count++; console.log('PASS', name) }
  await check('compact selector is unique; locate/search callbacks and visibility remain independent', assertCompactLibraryToolbar)
  await check('sidebar renders locate rather than a duplicate list title; portrait and Android retained', assertSidebarLibraryToolbar)
  await check('production toolbar -> parent event -> list scroll uses stable ID, never queue index', async() => {
    const f = mountedListFixture(); await f.flush()
    const before = JSON.stringify(f.player)
    f.click(); await f.flush()
    assert.deepEqual(f.calls.index, [{ index: 1, viewPosition: .3, animated: true }])
    assert.equal(f.calls.playback, 0)
    assert.equal(JSON.stringify(f.player), before)
    f.click(); await f.flush()
    assert.equal(f.calls.index.length, 2, 'Repeat clicks must still locate')
    f.unmount()
    assert.equal(f.app.listenerCount('jumpListPosition'), 0)
    assert.equal(f.events.listenerCount('mylistToggled'), 0)
  })
  await check('production list switches to containing library and scrolls after async load', async() => {
    const f = mountedListFixture(); f.songs.A = [{ id: 'other' }]; f.player.playMusicInfo.listId = 'B'
    await f.flush(); f.click(); await f.flush()
    assert.equal(f.list.activeListId, 'B')
    assert.deepEqual(f.calls.active, ['B'])
    assert.deepEqual(f.calls.index, [{ index: 0, viewPosition: .3, animated: false }])
    assert.equal(f.calls.playback, 0); f.unmount()
  })
  await check('production locate discards pending reads after song change, list change or unmount', async() => {
    for (const change of ['song', 'list', 'unmount']) {
      const f = mountedListFixture(); await f.flush()
      let resolve
      f.setRead(() => new Promise(r => { resolve = r }))
      f.click(); await settle(); assert.equal(typeof resolve, 'function')
      if (change === 'song') f.player.playMusicInfo.musicInfo = { id: 'new-song' }
      else if (change === 'list') f.list.activeListId = 'B'
      else f.unmount()
      resolve(f.songs.A); await f.flush()
      assert.equal(f.calls.index.length, 0, change)
      assert.equal(f.calls.active.length, 0, change)
      assert.equal(f.calls.toast.length, 0, change)
      f.unmount()
    }
  })
  await check('production repeat clicks supersede older unresolved locate requests', async() => {
    const f = mountedListFixture(); await f.flush()
    const pending = []
    f.setRead(() => new Promise(resolve => pending.push(resolve)))
    f.click(); f.click(); await settle()
    assert.equal(pending.length, 2)
    pending[1](f.songs.A); await f.flush()
    pending[0](f.songs.A); await f.flush()
    assert.equal(f.calls.index.length, 1)
    assert.equal(f.calls.index[0].index, 1); f.unmount()
  })
  await check('production missing-song and read-failure paths do not jump or mutate playback', async() => {
    const f = mountedListFixture(); await f.flush()
    f.player.playMusicInfo.musicInfo = null
    f.click(); await f.flush()
    assert.equal(f.calls.toast.pop(), '当前没有正在播放的歌曲')
    f.player.playMusicInfo.musicInfo = { id: 'missing' }
    f.click(); await f.flush()
    assert.equal(f.calls.toast.pop(), '正在播放的歌曲不在我的列表中')
    f.setRead(async() => { throw Error('test read failure') })
    f.click(); await f.flush()
    assert.equal(f.calls.toast.pop(), '定位失败，请重试')
    assert.equal(f.calls.index.length, 0); assert.equal(f.calls.active.length, 0)
    assert.equal(f.calls.playback, 0); f.unmount()
  })
  console.log(`${count} My Lists production-path checks passed; native UI acceptance remains a separate gate.`)
}
module.exports = { assertCompactLibraryToolbar, assertSidebarLibraryToolbar }
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1 })
