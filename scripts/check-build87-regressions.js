// Execute the changed production control paths. These are not a substitute for
// the native MP3/FLAC, system appearance, screenshot and Archive/IPA gates.
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript')
const { EventEmitter } = require('node:events')
const root = path.resolve(__dirname, '..'), read = file => fs.readFileSync(path.join(root, file), 'utf8')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b }); return {promise,resolve,reject} }
const load = (file, mocks = {}, globals = {}) => {
  const result = ts.transpileModule(read(file), { fileName: file, reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } })
  assert.equal((result.diagnostics || []).filter(d => d.category === 1).length, 0, file)
  const exports = {}
  vm.runInNewContext(result.outputText, { exports, console, setTimeout, clearTimeout, ...globals,
    require: name => { assert.ok(name in mocks, `${file}: missing ${name}`); return mocks[name] } }, { filename: file })
  return exports
}
let count = 0
const check = async(name, run) => { await run(); count++; console.log('PASS ' + name) }
const latest = load('src/core/player/latestSeek.ts')
const pureTheme = load('src/theme/systemTheme.ts')
const themes = load('src/theme/themes/themes.ts').default
const plain = value => JSON.parse(JSON.stringify(value))
const bus = () => new EventEmitter()
;(async() => {
  await check('20 rapid targets collapse to the last target; zero is valid', async() => {
    const calls=[], results=[], errors=[]
    const seek=latest.createLatestSeek({delay:5,seek:async target=>{calls.push(target);return target},onResult:p=>results.push(p),onError:e=>errors.push(e)})
    for(let i=0;i<20;i++)seek.request(i)
    assert.equal(seek.busy,true);await sleep(25)
    assert.deepEqual(calls,[19]);assert.deepEqual(results,[19]);assert.equal(seek.busy,false)
    seek.request(0);await sleep(25);assert.deepEqual(results,[19,0]);assert.equal(errors.length,0)
    for(const invalid of [NaN,Infinity,-1])seek.request(invalid)
    await sleep(10);assert.equal(calls.length,2)
  })
  await check('one in-flight seek; expired completion cannot replace the new target',async()=>{
    const first=deferred(),calls=[],results=[]
    const seek=latest.createLatestSeek({delay:3,seek:target=>{calls.push(target);return target===5?first.promise:Promise.resolve(target)},onResult:p=>results.push(p),onError:()=>assert.fail('unexpected seek error')})
    seek.request(5);await sleep(10)
    seek.request(10);seek.request(15);seek.request(20);await sleep(10)
    assert.deepEqual(calls,[5]);first.resolve(5);await sleep(10)
    assert.deepEqual(calls,[5,20]);assert.deepEqual(results,[20])
  })
  await check('cancel drops delayed targets, stale errors and stale media completions',async()=>{
    const pending=deferred(),results=[],errors=[],calls=[]
    const seek=latest.createLatestSeek({delay:3,seek:t=>{calls.push(t);return pending.promise},onResult:p=>results.push(p),onError:e=>errors.push(e)})
    seek.request(5);seek.cancel();await sleep(10);assert.equal(calls.length,0)
    seek.request(9);await sleep(10);seek.cancel();pending.reject(Error('old track'));await sleep(10)
    assert.equal(results.length,0);assert.equal(errors.length,0);assert.equal(seek.busy,false)
    const bad=latest.createLatestSeek({delay:1,seek:async()=>NaN,onResult:()=>assert.fail(),onError:e=>errors.push(e)})
    bad.request(4);await sleep(10);assert.equal(errors.length,1)
  })
  await check('iOS settling only reads native time and never resubmits old targets',async()=>{
    const calls=[];let position=0
    const module=load('src/plugins/player/seek.ts',{
      'react-native-track-player':{default:{seekTo:async t=>{calls.push(t)},getPosition:async()=>position}},
      'react-native':{Platform:{OS:'ios'},NativeModules:{TrackPlayerModule:{getPosition:async()=>position}}},
    },{setTimeout:fn=>setTimeout(fn,1)})
    assert.equal(await module.seekToTime(15),0) // slow native state: do not invent 15
    assert.deepEqual(calls,[15])
    position=0;assert.equal(await module.seekToTime(0),0);assert.deepEqual(calls,[15,0])
    position=NaN;await assert.rejects(module.seekToTime(2),/Invalid native/)
    await assert.rejects(module.seekToTime(Infinity),/Invalid seek/)
  })
  await check('actual shortcut + progress listeners accumulate targets and reject pre-seek polling',async()=>{
    const app=bus(),stateEvents=bus(),oldQuery=deferred(),seeks=[],lyric=[],writes=[]
    const player={musicInfo:{id:'song-a'},playMusicInfo:{listId:'default',musicInfo:{id:'song-a',interval:'00:30'},isTempPlay:true},playInfo:{playIndex:0},progress:{nowPlayTime:1,maxPlayTime:30},isPlay:true}
    let interval,remote,native=1,firstQuery=true
    app.seekLyric=p=>lyric.push(p);app.setProgress=p=>app.emit('setProgress',p)
    const settings={setting:{'player.playbackRate':1,'keyboard.enabled':true,'keyboard.seek':true}}
    const shared={global:{app_event:app,state_event:stateEvents,lx:{}}}
    const init=load('src/core/init/player/playProgress.ts',{
      '@/core/list':{updateListMusics:async()=>{}},'@/core/player/progress':{
        setNowPlayTime:p=>{player.progress.nowPlayTime=p;writes.push(p)},setMaxplayTime:p=>{player.progress.maxPlayTime=p}},
      '@/core/player/timeline':{getTimelineDuration:(_,n)=>n},'@/plugins/player/utils':{
        setCurrentTime:async p=>{seeks.push(p);native=p;return p},getDuration:async()=>30,
        getPosition:()=>{if(firstQuery){firstQuery=false;return oldQuery.promise}return Promise.resolve(native)}},
      '@/utils/common':{formatPlayTime2:String},'@/utils/data':{savePlayInfo:async()=>{}},
      '@/utils/tools':{throttleBackgroundTimer:f=>f,toast:()=>assert.fail('unexpected toast')},
      'react-native-background-timer':{default:{setInterval:f=>{interval=f;return 1},clearInterval:()=>{}}},
      '@/store/player/state':{default:player},'@/store/setting/state':settings.default?settings:{default:settings},
      '@/utils/nativeModules/utils':{onScreenStateChange:()=>()=>{}},'react-native':{AppState:{addEventListener:()=>({remove(){}})}},
      '@/core/player/latestSeek':latest,
    },shared).default
    const cleanup=init();app.emit('play');await sleep(5)
    const initRemote=load('src/core/init/player/remoteCommand.ts',{
      '@/utils/nativeModules/utils':{configureKeyboard:()=>{},onRemoteCommand:f=>{remote=f}},
      '@/core/player/player':{pause:async()=>{},play(){},playNext:async()=>{},playPrev:async()=>{},togglePlay(){}},
      '@/core/player/timeoutExit':{markTimeoutExitInteraction(){}},'@/core/common':{setNavActiveId(){}},
      '@/core/keyboardRouter':{keyboardRouter:{dispatch(){},blocked:false}},'@/store/setting/state':{default:settings},
      '@/store/player/state':{default:player},'@/store/common/state':{default:{componentIds:{}}},
      '@/navigation':{popToRoot:async()=>{}},'@/utils/tools':{toast:()=>{}},
    },shared).default
    initRemote()
    for(const command of ['seek_forward','seek_forward','seek_backward','seek_forward'])remote({source:'keyboard',command})
    assert.equal(player.progress.nowPlayTime,11)
    oldQuery.resolve(1);await sleep(10);assert.equal(player.progress.nowPlayTime,11)
    await sleep(160);assert.deepEqual(seeks,[11]);assert.equal(player.progress.nowPlayTime,11)
    interval();await sleep(5);assert.equal(player.progress.nowPlayTime,11)
    app.setProgress(29);app.emit('musicToggled');player.musicInfo.id='song-b';await sleep(150);assert.deepEqual(seeks,[11])
    app.setProgress(0);await sleep(160);assert.deepEqual(seeks,[11,0]);assert.equal(player.progress.nowPlayTime,0)
    cleanup();assert.equal(app.listenerCount('setProgress'),0)
  })
  const setting={'theme.id':'auto','common.isAutoTheme':true,'theme.lightId':'blue','theme.darkId':'black'}
  await check('independent presets, fixed mode, legacy mode and invalid imports resolve correctly',()=>{
    assert.equal(pureTheme.selectSystemTheme(themes,setting,false).id,'blue')
    assert.equal(pureTheme.selectSystemTheme(themes,setting,true).id,'black')
    const fixed={...setting,'theme.id':'purple','common.isAutoTheme':false}
    assert.equal(pureTheme.selectSystemTheme(themes,fixed,true).id,'purple')
    const legacy={...fixed,'theme.id':'red','common.isAutoTheme':true}
    assert.equal(pureTheme.selectSystemTheme(themes,legacy,false).id,'red')
    assert.equal(pureTheme.selectSystemTheme(themes,legacy,true).id,'black')
    const invalid={...setting,'theme.lightId':'black','theme.darkId':'blue'}
    assert.equal(pureTheme.selectSystemTheme(themes,invalid,false).id,'green')
    assert.equal(pureTheme.selectSystemTheme(themes,invalid,true).id,'black')
    assert.throws(()=>pureTheme.selectSystemTheme([],setting,true),/No compatible/)
  })
  await check('theme refresh rejects stale promises; preset validation preserves the other group',async()=>{
    const a=deferred(),b=deferred(),applied=[],cfg={setting:{...setting}},state={theme:{id:'blue'}},calls=[]
    const core=load('src/core/theme.ts',{'@/store/theme/action':{default:{setTheme:t=>applied.push(t),setShouldUseDarkColors(){}}},
      '@/theme/themes':{getTheme:()=>calls.length?b.promise:(calls.push('first'),a.promise),getAllThemes:async()=>({themes,userThemes:[]})},
      './common':{updateSetting:patch=>Object.assign(cfg.setting,patch)},'@/store/theme/state':{default:state},'@/store/setting/state':{default:cfg}})
    const first=core.refreshTheme(),second=core.refreshTheme();b.resolve({id:'black'});await second;a.resolve({id:'blue'});await first
    assert.deepEqual(plain(applied),[{id:'black'}])
    await core.setThemeVariant('red',false);assert.equal(cfg.setting['theme.lightId'],'red');assert.equal(cfg.setting['theme.darkId'],'black')
    await assert.rejects(core.setThemeVariant('blue',true),/appearance group/)
  })
  await check('live system reader ignores fixed-window Appearance overrides and cleans listeners',async()=>{
    const events=bus(),cfg={setting:{...setting}},state={theme:{id:'blue',isDark:false},shouldUseDarkColors:false}
    let systemDark=false,change,appChange,disposed=0;const appearances=[]
    const refresh=async()=>{const next=pureTheme.selectSystemTheme(themes,cfg.setting,state.shouldUseDarkColors);state.theme=next;events.emit('themeUpdated',next)}
    const init=load('src/core/init/theme.ts',{
      'react-native':{Platform:{OS:'ios'},NativeModules:{LXWindowAppearance:{getSystemDark:async()=>systemDark}},AppState:{addEventListener:(_,f)=>{appChange=f;return {remove:()=>disposed++}}}},
      '@/utils/tools':{getAppearance:()=> 'light',getIsSupportedAutoTheme:()=>true,onAppearanceChange:f=>{change=f;return{remove:()=>disposed++}}},
      '@/core/theme':{setShouldUseDarkColors:d=>{state.shouldUseDarkColors=d},refreshTheme:refresh},
      '@/store/setting/state':{default:cfg},'@/navigation/appearance':{applyNavigationAppearance:(...args)=>appearances.push(args)},
      '@/store/theme/state':{default:state},'@/theme/systemTheme':pureTheme,
    },{global:{state_event:events}}).default
    const cleanup=await init(cfg.setting)
    systemDark=true;change('light');await sleep(10);assert.equal(state.theme.id,'black');assert.equal(appearances.at(-1)[1],true)
    cfg.setting['theme.lightId']='red';events.emit('configUpdated',['theme.lightId']);await sleep(10);assert.equal(state.theme.id,'black')
    systemDark=false;appChange('active');await sleep(10);assert.equal(state.theme.id,'red')
    cfg.setting['theme.id']='purple';cfg.setting['common.isAutoTheme']=false;events.emit('configUpdated',['theme.id']);await sleep(10)
    systemDark=true;change('dark');await sleep(10);assert.equal(state.theme.id,'purple');assert.equal(appearances.at(-1)[1],false)
    cleanup();assert.equal(disposed,2);assert.equal(events.listenerCount('configUpdated'),0)
  })
  await check('actual navigation uses unspecified windows only for automatic mode',()=>{
    const calls=[]
    const nav=load('src/navigation/appearance.ts',{
      'react-native':{Platform:{OS:'ios'},StatusBar:{setBarStyle(){}},NativeModules:{LXWindowAppearance:{setAuto:()=>calls.push('auto'),setDark:d=>calls.push(d)}}},
      'react-native-navigation':{Navigation:{setDefaultOptions(){},mergeOptions(){}}},'@/store/common/state':{default:{componentIds:{}}},
    })
    nav.applyNavigationAppearance(true,true);nav.applyNavigationAppearance(false,false);assert.deepEqual(calls,['auto',false])
    const native=read('ios/LxMusicMobile/LXWindowInsets.swift'),bridge=read('ios/LxMusicMobile/LXWindowInsetsBridge.m')
    assert.ok(native.includes('window.overrideUserInterfaceStyle = .unspecified'))
    assert.ok(native.includes('scene?.traitCollection.userInterfaceStyle'))
    assert.ok(bridge.includes('getSystemDark:(RCTPromiseResolveBlock)resolve'))
    const added = native.slice(native.indexOf('  @objc func setAuto()'), native.indexOf('  private func refresh('))
    assert.equal(require('node:crypto').createHash('sha256').update(native.replace(added, '')).digest('hex'),
      '0e02398721406aac184fd493aa2fc7a69f3e019d174c5784acc6ec4b6d041d88', 'Existing safe-area and fixed-theme native code changed')
  })
  await check('real preset components render split preview, grouped selection and callbacks without title fills',async()=>{
    const cfg={...setting},pressed=[]
    const jsx=(type,props)=>({type,props}),nodes=t=>Array.isArray(t)?t.flatMap(nodes):t&&typeof t==='object'?[t,...nodes(t.props?.children)]:[]
    const comp=load('src/screens/Home/Views/Setting/settings/Theme/AutoTheme.tsx',{
      react:{forwardRef:f=>f,useEffect:()=>{},useState:()=>[{themes,dataPath:'/themes'},()=>{}]},
      'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{ScrollView:'ScrollView',TouchableOpacity:'TouchableOpacity',View:'View'},
      '@/components/common/Dialog':{default:'Dialog'},'@/components/common/Text':{default:'Text'},'@/components/common/ImageBackground':{default:'Image'},
      '@/lang':{useI18n:()=>key=>key},'@/store/theme/hook':{useTheme:()=>({'c-primary-font':'#248bce','c-font':'#333'})},
      '@/store/setting/hook':{useSettingValue:key=>cfg[key]},'@/theme/themes':{BG_IMAGES:{},getAllThemes:async()=>({themes,userThemes:[]})},
      '@/theme/systemTheme':pureTheme,'@/core/theme':{setThemeVariant:async(id,dark)=>pressed.push([id,dark])},'@/utils/tools':{toast:()=>assert.fail()},
    })
    const auto=comp.AutoThemeItem({visible:true,onPress:()=>pressed.push('auto')})
    assert.equal(auto.props.accessibilityState.selected,true);assert.ok(nodes(auto).some(n=>n.props?.style?.borderBottomWidth===28));auto.props.onPress()
    const dialog=comp.AutoThemeDialog({},{}),presets=nodes(dialog).filter(n=>n.type===comp.ThemePreset)
    assert.equal(presets.length,themes.length);assert.equal(presets.filter(n=>n.props.selected).length,2)
    const selected=presets.find(n=>n.props.item.id==='blue'),rendered=comp.ThemePreset(selected.props)
    assert.equal(rendered.props.accessibilityState.selected,true);assert.equal(rendered.props.accessibilityRole,'radio')
    rendered.props.onPress();await sleep(1);assert.deepEqual(pressed,['auto',['blue',false]])
    for(const n of nodes(rendered).filter(n=>n.type==='Text'))assert.ok(!n.props.style?.backgroundColor)
    const selectedIds=()=>nodes(comp.AutoThemeDialog({},{})).filter(n=>n.type===comp.ThemePreset&&n.props.selected).map(n=>n.props.item.id)
    // Upgrading an existing automatic user must preview the effective legacy
    // light theme, not the untouched default theme.lightId.
    Object.assign(cfg,{'theme.id':'red','common.isAutoTheme':true,'theme.lightId':'green'})
    const legacyAuto=comp.AutoThemeItem({visible:true,onPress(){}})
    assert.equal(nodes(legacyAuto).find(n=>n.props?.style?.overflow==='hidden').props.style.backgroundColor,
      themes.find(t=>t.id==='red').config.themeColors['c-theme'],'legacy automatic swatch differs from the applied light theme')
    assert.deepEqual(selectedIds(),['red','black'])
    // The same fallback used by playback UI must remain selected when an
    // imported/deleted preset is missing or belongs to the wrong appearance.
    Object.assign(cfg,{'theme.id':'auto','theme.lightId':'deleted-theme','theme.darkId':'blue'})
    assert.deepEqual(selectedIds(),['green','black'])
    Object.assign(cfg,{'theme.id':'purple','common.isAutoTheme':false,'theme.lightId':'blue','theme.darkId':'black'})
    assert.deepEqual(selectedIds(),['blue','black'],'editing presets in fixed mode must not select the fixed theme')
  })
  await check('production scene geometry/audio/sync baseline preserved; explicit feature gates remain required',()=>{
    const baseline=JSON.parse(read('docs/BUILD86_BASELINE_HASHES.json')),hash=require('node:crypto').createHash
    for(const [file,expected] of Object.entries(baseline))assert.equal(hash('sha256').update(file === 'ios/LxMusicMobile/AppDelegate.mm' ? require('./native-build88-preservation').legacyNativeSource(read(file)) : read(file)).digest('hex'),expected,file)
    const workflow=read('.github/workflows/ios-ipa.yml')
    assert.ok(workflow.includes('node scripts/check-build87-regressions.js'))
    assert.ok(workflow.includes('assert len(images) == 54'))
    assert.ok(read('src/tests/playbackSmoke.tsx').includes("bounded(getPosition(), 'getPosition', 3000)"))
    assert.ok(read('src/tests/playbackSmoke.tsx').includes('runSeekBurstSmoke'))
    assert.ok(read('scripts/run-ios-playback-smoke.py').includes('system-theme.json'))
    assert.equal(JSON.parse(read('package.json')).versionCode,88)
  })
  await check('real iOS platform capability gate registers and cleans Appearance events', require('./check-build87-platform-theme'))
  fs.mkdirSync(path.join(root,'build/checks'),{recursive:true})
  fs.writeFileSync(path.join(root,'build/checks/build87.json'),JSON.stringify({groups:count,success:true,native:'separate required CI gate'},null,2))
  console.log(`${count} Build87 behavioral groups passed. Native playback and system appearance still require iOS Actions.`)
})().catch(error=>{console.error(error);process.exitCode=1})
