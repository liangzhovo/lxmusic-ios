// Executable policy, ordering and lifecycle regressions. Native keyboard,
// real sync peers and audio playback are additional, mandatory Actions tests.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript')
const root=path.resolve(__dirname,'..'), read=f=>fs.readFileSync(path.join(root,f),'utf8')
function load(file,mocks={},extras={}){
 const code=ts.transpileModule(read(file),{fileName:file,compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText
 const exports={};vm.runInNewContext(code,{exports,console,setTimeout,clearTimeout,Promise,Buffer,Set,Map,AbortController,...extras,require:n=>{assert.ok(n in mocks,'mock missing '+n+' in '+file);return mocks[n]}});return exports
}
const plain=x=>JSON.parse(JSON.stringify(x));const sleep=ms=>new Promise(r=>setTimeout(r,ms))
let count=0;const check=async(name,fn)=>{await fn();count++;console.log('PASS '+name)}
;(async()=>{
 const {selectionColors}=load('src/utils/selectionColors.ts')
 await check('multi-selection preserves upstream theme surface; no hard-coded heading selection palette',()=>{
  for(const isDark of [false,true]){const theme={isDark,'c-primary-background-hover':isDark?'rgba(20,100,80,0.3)':'rgba(70,150,110,0.2)','c-font':isDark?'#ddd':'#333','c-primary-font':'#457865','c-border-background':'#678'};const c=selectionColors(theme);assert.equal(c.background,theme['c-primary-background-hover']);assert.equal(c.text,theme['c-font']);assert.equal(c.indicator,theme['c-primary-font'])}
 })
 const {KeyboardRouter,nextKeyboardIndex}=load('src/core/keyboardRouter.ts')
 await check('keyboard routing isolates modal, visible page and newer focused target',()=>{
  const router=new KeyboardRouter(),calls=[];let visible=true
  router.register({layer:0,enabled:()=>visible,handle:a=>(calls.push(['base',a]),true)})
  router.register({layer:0,enabled:()=>false,handle:a=>(calls.push(['hidden',a]),true)})
  assert.ok(router.dispatch('select_down'));router.openLayer(3);assert.ok(!router.dispatch('select_enter'))
  const off=router.register({layer:3,enabled:()=>true,handle:a=>(calls.push(['modal',a]),true)})
  router.dispatch('select_enter');off();router.closeLayer(3);visible=false;assert.ok(!router.dispatch('select_enter'))
  assert.deepEqual(calls,[['base','select_down'],['modal','select_enter']]);assert.ok(!router.blocked)
 })
 await check('arrow selection bounds and empty/first/last items do not auto-play',()=>{
  assert.equal(nextKeyboardIndex(-1,1,100),0);assert.equal(nextKeyboardIndex(-1,-1,100),99)
  assert.equal(nextKeyboardIndex(99,1,100),99);assert.equal(nextKeyboardIndex(0,-1,100),0);assert.equal(nextKeyboardIndex(0,1,0),-1)
 })
 await check('real song keyboard hook advances fast repeats, scrolls, and Enter alone activates',()=>{
  const router=new KeyboardRouter(),effects=[],positions=[],played=[];const enabled={},layer={};let value
  const use=load('src/utils/hooks/useSongKeyboard.ts',{
    react:{useContext:c=>c===enabled?true:0,useEffect:f=>effects.push(f()),useRef:x=>({current:x}),useState:x=>[x,v=>value=v]},
    '@/core/keyboardRouter':{keyboardRouter:router,nextKeyboardIndex},'@/components/KeyboardScope':{KeyboardEnabled:enabled,KeyboardLayer:layer},
  }).default
  use([{id:'one'},{id:'two'},{id:'three'}],i=>played.push(i.id),i=>positions.push(i),'three')
  router.dispatch('select_down');router.dispatch('select_down');assert.equal(value,'two');assert.equal(played.length,0)
  router.dispatch('select_enter');assert.deepEqual(played,['two']);router.dispatch('locate_current');assert.equal(value,'three');assert.deepEqual(positions,[0,1,2])
  effects.forEach(f=>f?.());assert.ok(!router.dispatch('select_enter'))
 })
 await check('keyboard preferences do not disable real media controls; seek clamps and modal blocks navigation',()=>{
  const defaults=load('src/config/defaultSetting.ts').default,settings={setting:{...defaults}},calls=[];let handler;const router=new KeyboardRouter()
  const globals={state_event:{on:()=>{}},app_event:{setProgress:t=>calls.push(['seek',t])}}
  load('src/core/init/player/remoteCommand.ts',{
    '@/utils/nativeModules/utils':{configureKeyboard:c=>calls.push(['configure',plain(c)]),onRemoteCommand:f=>handler=f},
    '@/core/player/player':{play:()=>calls.push('play'),pause:async()=>calls.push('pause'),playNext:async()=>calls.push('next'),playPrev:async()=>calls.push('prev'),togglePlay:()=>calls.push('toggle')},
    '@/core/player/timeoutExit':{markTimeoutExitInteraction:()=>{}},'@/core/common':{setNavActiveId:id=>calls.push(id)},'@/core/keyboardRouter':{keyboardRouter:router},
    '@/store/setting/state':{default:settings},'@/store/player/state':{default:{playMusicInfo:{musicInfo:{id:'a'}},progress:{nowPlayTime:2,maxPlayTime:4}}},
    '@/store/common/state':{default:{componentIds:{}}},'@/navigation':{popToRoot:async()=>{}},'@/utils/tools':{toast:()=>{}},
  },{global:globals}).default()
  settings.setting['keyboard.enabled']=false;handler({command:'toggle',source:'keyboard'});assert.ok(!calls.includes('toggle'))
  handler({command:'play'});assert.ok(calls.includes('play'))
  settings.setting['keyboard.enabled']=true;handler({command:'seek_backward',source:'keyboard'});handler({command:'seek_forward',source:'keyboard'})
  assert.ok(calls.some(x=>Array.isArray(x)&&x[0]==='seek'&&x[1]===0));assert.ok(calls.some(x=>Array.isArray(x)&&x[0]==='seek'&&x[1]===4))
  router.openLayer(7);handler({command:'nav_setting',source:'keyboard'});assert.ok(!calls.includes('nav_setting'));router.closeLayer(7)
  handler({command:'nav_setting',source:'keyboard'});assert.ok(calls.includes('nav_setting'))
 })
 const addresses=load('src/plugins/sync/address.ts')
 await check('sync address accepts desktop address, TLS proxy path and IPv6 without losing port/path',()=>{
  assert.equal(addresses.normalizeSyncAddress(' 192.168.1.5:9527/ '),'http://192.168.1.5:9527')
  assert.deepEqual(plain(addresses.parseSyncAddress('https://sync.example.com/lx/')),{href:'https://sync.example.com/lx',httpProtocol:'https:',wsProtocol:'wss:',hostPath:'sync.example.com/lx'})
  assert.equal(addresses.parseSyncAddress('http://[::1]:9527').hostPath,'[::1]:9527')
 })
 await check('invalid sync credentials/URL syntax fail explicitly instead of silently not connecting',()=>{
  for(const value of ['', 'ftp://host/path','http://name:password@host','http://host:0','http://host:65536','http://host?x=1','http://host/#fragment','hello world']) assert.throws(()=>addresses.normalizeSyncAddress(value),undefined,value)
 })
 await check('async native AES authentication receives UTF8 bytes for Chinese/non-ASCII device names',async()=>{
  let captured=''
  const aes=load('src/plugins/sync/utils.ts',{buffer:{Buffer},'@/utils/nativeModules/crypto':{AES_MODE:{ECB_128_NoPadding:'AES'},RSA_PADDING:{},aesEncrypt:async text=>(captured=text,'encrypted')}})
  assert.equal(await aes.aesEncrypt('lx-music auth::\n测试的iPad 🌸','a2V5'),'encrypted')
  assert.equal(Buffer.from(captured,'base64').toString('utf8'),'lx-music auth::\n测试的iPad 🌸')
 })
 await check('mode overlay uses a real id before show and ignores wrong module selections',async()=>{
  const {EventEmitter}=require('node:events');const e=new EventEmitter(),state={},shown=[],closed=[],router=new KeyboardRouter()
  const mod=load('src/core/sync.ts',{'@/core/keyboardRouter':{keyboardRouter:router},'@/navigation':{dismissOverlay:async id=>closed.push(id),onModalDismissed:()=>()=>{},showSyncModeModal:async id=>shown.push(id)},
    '@/store/sync/state':{default:state},'@/store/sync/action':{default:{setStatus:()=>{},setMessage:()=>{},setServerInfo:()=>{},setSyncModeComponentId:id=>state.syncModeComponentId=id}}},{global:{app_event:e}})
  let settled=false;const first=mod.selectSyncMode('PC','list').then(v=>{settled=true;return v});const id=state.syncModeComponentId;assert.ok(id);assert.equal(shown[0],id);assert.ok(router.blocked);assert.ok(!router.dispatch('select_enter'))
  e.emit('selectSyncMode',{type:'dislike',mode:'cancel'});await sleep(0);assert.ok(!settled)
  e.emit('selectSyncMode',{type:'list',mode:'merge_local_remote'});assert.equal(await first,'merge_local_remote');assert.equal(e.listenerCount('selectSyncMode'),0);assert.ok(!router.blocked)
  const second=mod.selectSyncMode('PC','list').catch(e=>String(e));const next=state.syncModeComponentId
  mod.cancelSyncModeForId(id);assert.equal(state.syncModeComponentId,next);mod.cancelSyncModeForId(next);assert.match(await second,/cancel/);assert.ok(!router.blocked)
  const third=mod.selectSyncMode('PC','list').catch(e=>String(e));assert.ok(router.dispatch('escape'));assert.match(await third,/cancel/);assert.ok(!router.blocked)
 })
 await check('new connection cancels stale authentication completion without changing current socket',async()=>{
  let resolve;const calls=[],status=[]
  const mod=load('src/plugins/sync/client/index.ts',{'../diagnostics':{resetSyncDiagnostic:()=>{},atSyncStage:async(_s,fn)=>fn()},'./auth':{default:url=>url.hostPath==='old'?new Promise(r=>resolve=r):Promise.resolve({key:'new'})},
    './client':{connect:(url,key)=>calls.push([url.hostPath,key.key]),disconnect:async()=>{},sendSyncStatus:x=>status.push(x)},
    './utils':{parseUrl:addresses.parseSyncAddress},'../constants':{SYNC_CODE:{connecting:'Connecting...',connectServiceFailed:'failed'}},'@/core/sync':{removeSyncModeEvent:()=>{}}})
  const old=mod.connectServer('old');await sleep(0);await mod.connectServer('new');resolve({key:'old'});await old
  assert.deepEqual(calls,[['new','new']]);await mod.disconnectServer();assert.equal(status.at(-1).status,false)
 })
 await check('websocket send and receive encoding are ordered; stale socket close cannot replace new status',async()=>{
  const instances=[],options=[],statuses=[];class Socket{constructor(){this.readyState=0;this.handlers={};this.sent=[];instances.push(this)}addEventListener(n,f){this.handlers[n]=f}send(x){this.sent.push(x)}close(){this.readyState=3}event(n,e={}){this.handlers[n]?.(e)}}
  const mod=load('src/plugins/sync/client/client.ts',{'./utils':{encryptMsg:async(_k,msg)=>{if(msg.includes('one'))await sleep(10);return msg},decryptMsg:async(_k,msg)=>{if(msg==='1')await sleep(10);return msg}},
    './sync':{callObj:{}},'../log':{default:{error:()=>{},r_error:()=>{}}},'../utils':{aesEncrypt:()=>''},'@/core/sync':{setSyncStatus:s=>statuses.push(s),removeSyncModeEvent:()=>{}},
    message2call:{createMsg2call:o=>{options.push(o);return {remote:{},createQueueRemote:()=>({}),destroy:()=>{},message:m=>received.push(m)}}},
    '../diagnostics':{atSyncStage:async(_s,fn)=>fn()},'../constants':{SYNC_CLOSE_CODE:{normal:1000,failed:4100},SYNC_CODE:{msgConnect:'connect'}},
  },{WebSocket:Socket});const received=[]
  await mod.connect(addresses.parseSyncAddress('old'),{clientId:'a',key:'key'});const a=instances[0];a.readyState=1;a.event('open');options[0].sendMessage('one');options[0].sendMessage('two');a.event('message',{data:'1'});a.event('message',{data:'2'});await sleep(30)
  assert.deepEqual(a.sent,['"one"','"two"']);assert.deepEqual(received,[1,2])
  await mod.connect(addresses.parseSyncAddress('new'),{clientId:'b',key:'key'});const b=instances[1];b.readyState=1;b.event('open');options[1].funcsObj.finished();const before=statuses.length;a.event('close',{code:1006});assert.equal(statuses.length,before);assert.equal(mod.getStatus().status,true)
  await mod.disconnect();assert.ok(!mod.hasClientConnection())
 })
 await check('per-socket list subscription disposal cannot unregister a replacement',()=>{
  const handlers=[],closed=[];const mod=load('src/plugins/sync/client/modules/list/localEvent.ts',{'@/plugins/sync/constants':{SYNC_CLOSE_CODE:{failed:4100}},'../../../listEvent':{registerListActionEvent:f=>{handlers.push(f);return()=>closed.push(f)}}})
  const a={},b={};mod.registerEvent(a);mod.registerEvent(b);mod.unregisterEvent(a);assert.deepEqual(closed,[handlers[0]]);mod.unregisterEvent(b);assert.deepEqual(closed,handlers)
 })
 await check('player bar belongs to the right content container on song detail, not the outer sidebar row',()=>{
  const ast=ts.createSourceFile('file.tsx',read('src/screens/SonglistDetail/index.tsx'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
  let checked=0;function walk(n){if(ts.isJsxSelfClosingElement(n)&&n.tagName.getText(ast)==='PlayerBar'){const parent=n.parent;assert.ok(ts.isJsxElement(parent));assert.ok(parent.openingElement.getText(ast).includes('flex: 1'));assert.ok(!parent.openingElement.getText(ast).includes("flexDirection: 'row'"));checked++}ts.forEachChild(n,walk)}walk(ast);assert.equal(checked,1)
 })
 await check('playlist uses live current state, stable item geometry and post-load current-song scroll',()=>{
  const s=read('src/screens/PlayDetail/Horizontal/components/PlaylistBtn.tsx');for(const token of ['usePlayMusicInfo()', 'getListMusics(id)','getItemLayout=', 'viewPosition: 0.35','onScrollToIndexFailed=', '定位正在播放', "backgroundColor: 'transparent'",'accessibilityState={{ selected: active }}'])assert.ok(s.includes(token),token)
  assert.ok(s.includes('[visible, currentIndex, list]'));assert.ok(!s.includes('<SongTableHeader'))
 })
 await check('settings expose granular shortcut controls and native input focus blocks shortcut interception',()=>{
  const defaults=load('src/config/defaultSetting.ts').default;for(const key of ['enabled','playback','seek','selection','navigation']){assert.equal(defaults['keyboard.'+key],true);assert.ok(read('src/screens/Home/Views/Setting/settings/Basic/KeyboardShortcuts.tsx').includes('keyboard.'+key))}
  const native=read('ios/LxMusicMobile/main.m');for(const token of ['LXIsEditingText','UITextInput','LXKeyboardShortcuts','UIKeyInputUpArrow','UIKeyInputDownArrow','@"source": @"keyboard"'])assert.ok(native.includes(token),token)
 })
 await check('about/version link to the port, distinguish original author and handle disabled Issues',()=>{
  const project=load('src/config/project.ts').PORT_PROJECT;assert.ok(project.repository.includes('skyhc/lx-music-mobile'));assert.ok(project.releases.endsWith('/releases'))
  assert.ok(read('src/screens/Home/Views/Setting/settings/About.tsx').includes('has_issues'))
  assert.ok(read('src/screens/Home/Views/Setting/settings/Version.tsx').includes('PORT_PROJECT.releases'))
  assert.ok(read('README.md').includes('Q-1515'));assert.ok(read('README.md').includes('lyswhut'))
 })
 console.log(`${count} Build 84 behavioral/source checks passed. Official-server native sync and hardware-key command tests run in Actions.`)
})().catch(e=>{console.error(e);process.exitCode=1})
