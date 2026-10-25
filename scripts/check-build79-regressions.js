const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const source = p => fs.readFileSync(path.join(root, p), 'utf8')
const load = (p, mocks = {}, globals = {}) => {
  const exports = {}
  const js = ts.transpileModule(source(p), { fileName: p, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText
  vm.runInNewContext(js, { exports, require: name => {
    if (name in mocks) return mocks[name]
    throw Error(`Unexpected dependency ${name} in ${p}`)
  }, console, setTimeout, clearTimeout, ...globals }, { filename: p })
  return exports
}
let n = 0
const check = async(name, fn) => { await fn(); n++; console.log('PASS', name) }
;(async() => {
  const layout = load('src/utils/layout.ts')
  await check('narrow / portrait / full-screen mode changes are reversible', () => {
    for (const [w,h,yes] of [[1366,1024,true],[600,500,false],[640,900,false],[820,1180,false],[1024,768,true],[700,500,true],[0,0,false]]) {
      assert.equal(layout.shouldUseIPadLayout(w,h), yes)
    }
  })
  let dims = { width: 1366, height: 1024, scale: 2 }
  let listener
  const native = { Platform: { OS: 'ios', isPad: true }, StatusBar: {}, Dimensions: {
    get: () => dims, addEventListener: (_, fn) => { listener = fn; return { remove() {} } },
  }, PixelRatio: { getFontScale: () => 1, get: () => 2, getPixelSizeForLayoutSize: x => x*2 } }
  const sizing = load('src/utils/windowSizeTools.ts', { 'react-native': native, './nativeModules/utils': { getWindowSize: async() => { throw Error('iOS should not wait for native pixel dimensions') } } })
  await sizing.windowSizeTools.init()
  await check('every resize delivered, including return to full screen; invalid sizes ignored', () => {
    const seen = []
    const remove = sizing.windowSizeTools.onSizeChanged(s => seen.push([s.width,s.height]))
    for (const [width,height] of [[600,500],[480,800],[1366,1024]]) {
      dims = { ...dims, width,height }; listener({ window: dims })
    }
    assert.deepEqual(seen, [[600,500],[480,800],[1366,1024]])
    sizing.windowSizeTools.setWindowSize(0,0)
    assert.equal(sizing.windowSizeTools.getSize().width, 1366)
    remove(); remove() // idempotent removal cannot splice another listener
  })
  const pixels = load('src/utils/pixelRatio.ts', { 'react-native': native, './windowSizeTools': sizing, './readability': load('src/utils/readability.ts') }, { global: { lx: { fontSize: 1 } } })
  await check('iOS text and secondary icons keep native point sizes during window resize', () => {
    for (const [w,h] of [[1366,1024],[400,550],[1366,1024]]) {
      sizing.windowSizeTools.setWindowSize(w,h)
      assert.equal(pixels.getTextSize(15),17)
      assert.equal(pixels.scaleSizeW(18),18)
      assert.equal(pixels.scaleSizeH(44),44)
    }
  })
  const { DiskAudioCache } = load('src/plugins/player/cache/DiskAudioCache.ts')
  await check('remote playback lease bypasses a permanently stuck native filesystem', async() => {
    const io = new Proxy({}, { get() { return () => new Promise(() => {}) } })
    const cache = new DiskAudioCache('/Library/Application Support/LXAudioCache/v1',io)
    const url = 'https://fixture.test/single-use.mp3'
    assert.equal(await Promise.race([cache.acquire(url),new Promise(resolve => setTimeout(() => resolve('BLOCKED'),100))]),url)
  })
  const { optionalTask } = load('src/plugins/player/cache/optionalTask.ts')
  await check('hanging or rejected cache lookups fall back instead of blocking audio', async() => {
    assert.equal(await optionalTask(new Promise(()=>{}),20,null,'test'),null)
    assert.equal(await optionalTask(Promise.reject(Error('Disk unavailable')),20,null,'test'),null)
    assert.equal(await optionalTask(Promise.resolve('file://hit.mp3'),20,null,'test'),'file://hit.mp3')
  })
  const queue = []; let playing = false; let seeks = 0; let resets = 0; let removes = 0; let skips = 0
  const track = {
    add: async t=>queue.push(...t), getQueue:async()=>queue,
    getCurrentTrack:async()=>queue.length ? 0 : null,
    skip:async()=>{skips++}, reset:async()=>{resets++; queue.splice(0)},
    play:async()=>{playing=true}, pause:async()=>{playing=false}, setVolume:async()=>{},
    remove:async()=>{removes++},
  }
  const core = load('src/plugins/player/trackPlayerCore.ts', {
    'react-native-track-player': { default: track }, '@/config': { defaultUrl: 'file://placeholder' },
    'react-native': { ...native, NativeModules: {} }, '@/store/setting/state': { default: { setting: { 'player.volume':0.7 } } },
    './fullLyric': { getCurrentFullLyric: () => undefined },
    './seek': { seekToTime: async n=>{seeks++; if(!n) throw Error('zero seek') } },
    '@/utils/nativeModules/nowPlaying': {},
  }, { global: { lx: {} } })
  const info = {id:'fixture',name:'Sine',singer:'CI',meta:{}}
  await check('system playback starts without seeking an unready item to zero', async()=>{
    await core.loadTrackPlayerResource(info,'https://fixture.test/tone.mp3',0,true)
    assert.equal(playing,true); assert.equal(seeks,0)
  })
  await check('iOS source replacement clears the old queue before opening cached media', async()=>{
    await core.loadTrackPlayerResource(info,'file://tone.mp3',3,false)
    assert.equal(playing,false); assert.equal(seeks,1)
    assert.equal(resets,1); assert.equal(removes,0); assert.equal(skips,0)
    assert.equal(queue.length,1); assert.equal(queue[0].url,'file://tone.mp3')
  })
  await check('cache URL resolution does not launch a competing download',()=>{
    const adapter=source('src/plugins/player/cache/index.ts')
    const start=adapter.indexOf('export const queueAudioCache')
    const end=adapter.indexOf('export const invalidateAudioCache',start)
    assert.ok(!adapter.slice(start,end).includes('cache.prefetch('))
    assert.ok(adapter.includes('progress[0] >= progress[1] - 0.25'))
    assert.ok(adapter.includes('exportCompletedStreamingFlac(url)'))
    assert.ok(!source('src/plugins/player/index.ts').includes('await configureAudioCache'))
  })
  await check('secondary controls share geometry; queue has a distinct list/play icon',()=>{
    assert.ok(source('src/screens/PlayDetail/Horizontal/MoreBtn/Btn.tsx').includes("from '../components/Btn'"))
    assert.ok(source('src/screens/PlayDetail/Horizontal/components/Btn.tsx').includes('BTN_ICON_SIZE = 18'))
    assert.ok(source('src/screens/PlayDetail/Horizontal/components/PlaylistBtn.tsx').includes('<PlaylistIcon />'))
    assert.ok(!source('src/screens/PlayDetail/Horizontal/components/PlaylistBtn.tsx').includes('icon="list-order"'))
  })
  await check('iOS library and primary navigation are visible without drawer-open events',()=>{
    assert.ok(source('src/screens/Home/Views/Mylist/MyList/index.tsx').includes("useState(Platform.OS == 'ios')"))
    assert.ok(source('src/screens/Home/Views/Mylist/index.tsx').includes('listSelector={sidebar ? undefined : <MyList compact />}'))
    assert.ok(source('src/screens/Home/Vertical/index.tsx').includes('<NavigationTabs />'))
    assert.ok(source('src/utils/tools.ts').includes("Platform.OS == 'ios') return { rowNum: 1, rowWidth: '100%' }"))
    assert.ok(source('src/components/OnlineList/List.tsx').includes("Platform.OS == 'ios' ? { rowNum: 1, rowWidth: '100%'"))
  })
  await check('modified TS/TSX sources parse',()=>{
    const cp = require('node:child_process')
    const paths=cp.execFileSync('git',['ls-files','--cached','--others','--exclude-standard'],{cwd:root,encoding:'utf8'}).trim().split('\n')
    for(const p of paths.filter(p=>/\.tsx?$/.test(p) && !p.endsWith('.d.ts') && fs.existsSync(path.join(root,p)))) {
      const diagnostics=ts.transpileModule(source(p),{fileName:p,reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX}}).diagnostics||[]
      assert.equal(diagnostics.filter(d=>d.category===ts.DiagnosticCategory.Error).length,0,p)
    }
  })
  console.log(`${n} Build 79 regression checks passed. Native playback validated separately in simulator.`)
})().catch(e=>{console.error(e);process.exit(1)})
