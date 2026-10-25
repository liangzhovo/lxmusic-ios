// Run actual transplanted SDK/cache code with deterministic services. Native
// audio and UI remain separate Release simulator gates in the Actions workflow.
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), cp = require('node:child_process')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const source = p => fs.readFileSync(path.join(root,p),'utf8')
const load = (p, mocks={}, extras={}) => {
  const out = {}; const result=ts.transpileModule(source(p),{fileName:p,reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}})
  assert.equal((result.diagnostics||[]).filter(d=>d.category===1).length,0,p)
  vm.runInNewContext(result.outputText,{exports:out,require:n=>{if(n in mocks)return mocks[n];throw Error(`Missing dependency ${n} (${p})`)},console,setTimeout,clearTimeout,Buffer,...extras},{filename:p})
  return out
}
let checks=0
const check=async(name,fn)=>{await fn();checks++;console.log('PASS',name)}
const clone=x=>JSON.parse(JSON.stringify(x))
;(async()=>{
  const revision=load('src/utils/musicCacheRevision.ts')
  await check('cache invalidation isolates song revisions and has a global reset',()=>{
    const before=revision.getMusicCacheRevision('a'),b=revision.getMusicCacheRevision('b')
    revision.invalidateMusicCacheRevision('a')
    assert.notEqual(revision.getMusicCacheRevision('a'),before);assert.equal(revision.getMusicCacheRevision('b'),b)
    revision.invalidateMusicCacheRevision();assert.notEqual(revision.getMusicCacheRevision('b'),b)
  })
  const disk=new Map(); let hold=null
  const storage={getData:async k=>disk.get(k)??null,getDataMultiple:async ks=>ks.map(k=>[k,disk.get(k)??null]),getAllKeys:async()=>[...disk.keys()],
    saveData:async(k,v)=>{if(hold)await hold;disk.set(k,v)},removeDataMultiple:async ks=>{for(const k of ks)disk.delete(k)}}
  const data=load('src/utils/data.ts',{'@/plugins/storage':storage,'@/config/constant':{DEFAULT_SETTING:{},LIST_IDS:{},storageDataPrefix:{musicUrl:'url_',lyric:'lrc_'}},'./common':{throttle:f=>f},'./musicCacheRevision':revision})
  const info={id:'song-a',source:'kw',name:'Hello',singer:'Tester',meta:{}}
  await check('clear song removes every URL quality but retains lyrics and other songs',async()=>{
    for(const q of data.qualitys)await data.saveMusicUrl(info,q,'https://old/'+q)
    await data.saveMusicUrl({...info,id:'song-b'},'128k','https://keep');disk.set('lrc_song-a','lyrics')
    await data.clearMusicUrlByMusic(info)
    assert.equal(await data.hasMusicUrlByMusic(info),false);assert.equal(disk.get('url_song-b_128k'),'https://keep');assert.equal(disk.get('lrc_song-a'),'lyrics')
  })
  await check('late URL response cannot republish an invalidated song cache',async()=>{
    const old=revision.getMusicCacheRevision(info.id);await data.clearMusicUrlByMusic(info)
    await data.saveMusicUrl(info,'flac','https://stale',old)
    assert.equal(await data.hasMusicUrlByMusic(info),false)
    await data.saveMusicUrl(info,'flac','https://fresh');assert.equal(await data.getMusicUrl(info,'flac'),'https://fresh')
  })
  await check('already-started writes complete before clear; subsequent writes still work',async()=>{
    let release;hold=new Promise(r=>{release=r})
    const saving=data.saveMusicUrl(info,'128k','https://in-flight');await new Promise(r=>setImmediate(r))
    const clearing=data.clearMusicUrlByMusic(info);hold=null;release();await Promise.all([saving,clearing])
    assert.equal(await data.hasMusicUrlByMusic(info),false)
    await data.saveMusicUrl(info,'128k','https://new');assert.equal(await data.hasMusicUrlByMusic(info),true)
  })
  let clears=[],nativeError=false
  const cacheActions=load('src/core/music/cache.ts',{'react-native':{Platform:{OS:'ios'}},'@/utils/data':data,
    '@/plugins/player/cache':{clearSongAudioCache:async m=>{clears.push(m.id);if(nativeError)throw Error('read-only disk')},lookupAudioCache:async(m,q)=>q==='flac'?'file://complete':null}})
  await check('iOS menu clear invalidates URL and audio without deleting local media',async()=>{
    await cacheActions.clearSongResourceCache(info);assert.deepEqual(clears,['song-a'])
    await cacheActions.clearSongResourceCache({...info,source:'local'});assert.equal(clears.length,1)
    assert.equal(await cacheActions.hasSongResourceCache(info),true)
  })
  await check('menu clear returns native failures, never a false success toast',async()=>{
    nativeError=true;await assert.rejects(cacheActions.clearSongResourceCache(info),/read-only disk/);nativeError=false
  })
  const settings={setting:{'player.playQuality':'128k'}}
  let resolveRequest, queues=[],suppressed=[],requests=0,hit=null
  const online=load('src/core/music/online.ts',{'@/utils/musicCacheRevision':revision,'@/utils/data':data,'@/core/list':{},'@/store/setting/state':{default:settings},
    '@/plugins/player/cache':{lookupAudioCache:async()=>hit,invalidateAudioCache:async()=>{},queueAudioCache:(...a)=>queues.push(a),suppressAudioCacheURL:u=>suppressed.push(u)},
    './utils':{getPlayQuality:q=>q,handleGetOnlineMusicUrl:()=>{requests++;return new Promise(r=>{resolveRequest=r})}}})
  await check('complete iOS cache precedes source resolution and URL lookup',async()=>{
    hit='file://complete';const result=await online.getMusicUrlInfo({musicInfo:info,isRefresh:false});assert.equal(result.url,hit);assert.equal(requests,0);hit=null
  })
  await check('clearing during online resolve suppresses stale audio persistence',async()=>{
    await data.clearMusicUrlByMusic(info);const pending=online.getMusicUrlInfo({musicInfo:info,isRefresh:false})
    await new Promise(r=>setImmediate(r));await cacheActions.clearSongResourceCache(info)
    resolveRequest({url:'https://late',quality:'128k',musicInfo:info,isFromCache:false});await pending
    assert.equal(await data.hasMusicUrlByMusic(info),false);assert.equal(queues.length,0);assert.deepEqual(suppressed,['https://late'])
  })
  await check('Android full-lyric metadata is gated by setting and current song',()=>{
    const platform={OS:'android'},setting={setting:{'player.isShowBluetoothFullLyric':true}},state={musicInfo:{id:'a',lrc:'[00:01] test'}}
    const full=load('src/plugins/player/fullLyric.ts',{'react-native':{Platform:platform},'@/store/setting/state':{default:setting},'@/store/player/state':{default:state}})
    assert.equal(full.getCurrentFullLyric('a'),'[00:01] test');assert.equal(full.getCurrentFullLyric('b'),undefined)
    platform.OS='ios';assert.equal(full.getCurrentFullLyric('a'),undefined)
  })
  const versions=load('src/utils/musicSdk/versionChars.ts');let candidates=[]
  const sdkMocks={'./versionChars':versions,'./api-source':{supportQuality:{}}}
  for(const s of ['kw','kg','tx','wy','mg','xm'])sdkMocks['./'+s]={default:{musicSearch:{search:async()=>({list:clone(candidates)})}}}
  const sdk=load('src/utils/musicSdk/index.js',sdkMocks)
  await check('upstream version matching rejects live and accompaniment for studio songs',async()=>{
    candidates=[{name:'Hello (Live)',singer:'Tester',albumName:'Album',interval:'03:00'},{name:'Hello (伴奏)',singer:'Tester',albumName:'Album',interval:'03:00'}]
    assert.equal((await sdk.findMusic({name:'Hello',singer:'Tester',albumName:'Album',interval:'03:00',source:'kw'})).length,0)
  })
  await check('source matching accepts equivalent tagged version and stable durations',async()=>{
    candidates=[{name:'Hello (Live)',singer:'Tester',albumName:'Album',interval:'03:01'}]
    assert.ok((await sdk.findMusic({name:'Hello (Live)',singer:'Tester',albumName:'Album',interval:'03:00',source:'kw'})).length>0)
    candidates=[{...candidates[0],interval:'08:00'}];assert.equal((await sdk.findMusic({name:'Hello (Live)',singer:'Tester',interval:'03:00',source:'kw'})).length,0)
  })
  await check('new clear-cache action remains wired to both full-label production menus',()=>{
    for(const dir of ['src/components/OnlineList','src/screens/Home/Views/Mylist/MusicList']){
      assert.ok(source(dir+'/ListMenu.tsx').includes("action: 'removeCache'"));assert.ok(source(dir+'/listAction.ts').includes('await clearSongResourceCache(musicInfo)'))
      assert.ok(source(dir+'/index.tsx').includes('onRemoveCache='));assert.ok(source(dir+'/ListMenu.tsx').includes('version != menuVersion.current'))
    }
  })
  await check('upstream critical source files are transplanted, not merely version-renamed',()=>{
    for(const p of ['src/utils/musicSdk/versionChars.ts','src/utils/musicSdk/kg/musicSearch.js','src/utils/musicSdk/tx/musicSearch.js','src/utils/musicSdk/mg/pic.js','src/utils/musicSdk/kw/decodeLyric.js']){
      const original=cp.execFileSync('git',['show','cd37a979a5845f1220b306b374285f5d38329e8d:'+p],{cwd:root,encoding:'utf8'})
      assert.equal(source(p),original,p)
    }
  })
  await check('tested audio engines and scene lifecycle survive the keyboard/UI extension',()=>{
    // Build84 intentionally adds keyboard commands, local-network permission and
    // selected-row UI. Protect the actual audio/scene implementation instead of
    // assuming that a later repair can never modify any UIKit bridge file.
    const baseline='22270f3c02d7ff7c47406ec7bd0410ac1be39371'
    const unchanged=cp.execFileSync('git',['diff','--name-only',baseline,'--','src/components/WindowContent.tsx','src/plugins/player/nativeFlac.ts','src/plugins/player/soundEffect'],{cwd:root,encoding:'utf8'})
    assert.equal(unchanged.trim(),'')
    // Build87 adds system-appearance methods in the same bridge as safe-area
    // measurement. Compare the pre-existing code byte-for-byte, rather than
    // incorrectly banning the requested extension of this file.
    const windowPath='ios/LxMusicMobile/LXWindowInsets.swift'
    const oldWindow=cp.execFileSync('git',['show',baseline+':'+windowPath],{cwd:root,encoding:'utf8'})
    const window=source(windowPath),start=window.indexOf('  @objc func setAuto()'),end=window.indexOf('  private func refresh(',start)
    assert.ok(start>=0&&end>start,'System appearance extension is missing')
    assert.equal(window.indexOf('  @objc func setAuto()',start+1),-1,'Duplicate system appearance extension')
    const extension=window.slice(start,end)
    assert.ok(extension.includes('window.overrideUserInterfaceStyle = .unspecified'))
    assert.ok(extension.includes('@objc(getSystemDark:rejecter:)'))
    assert.ok(extension.includes('scene?.traitCollection.userInterfaceStyle'))
    assert.equal(window.slice(0,start)+window.slice(end),oldWindow,'Existing safe-area or fixed-theme code changed')
    const p='ios/LxMusicMobile/AppDelegate.mm'
    const original=cp.execFileSync('git',['show',baseline+':'+p],{cwd:root,encoding:'utf8'}),current=source(p)
    const prefix='@interface UtilsModule',crypto='@interface CryptoModule',test='#if TARGET_OS_SIMULATOR',scene='@implementation AppDelegate'
    assert.ok(current.includes(prefix)&&current.includes(crypto)&&current.includes(scene))
    assert.equal(current.slice(0,current.indexOf(prefix)),original.slice(0,original.indexOf(prefix)),'audio/cache/native metadata changed')
    assert.equal(current.slice(current.indexOf(crypto),current.indexOf(test,current.indexOf(crypto))),original.slice(original.indexOf(crypto),original.indexOf(test,original.indexOf(crypto))),'production crypto changed')
    const preserved = require('./native-build88-preservation').legacyNativeSource(current)
    assert.equal(preserved.slice(preserved.indexOf(scene)),original.slice(original.indexOf(scene)),'scene lifecycle outside the reviewed restore hook changed')
  })
  await check('upstream dependency lock, monotonic iOS build and changelog are consistent',()=>{
    const pkg=JSON.parse(source('package.json')),lock=JSON.parse(source('package-lock.json'))
    assert.equal(pkg.version,'1.9.0');assert.equal(pkg.versionCode,88);assert.equal(lock.version,'1.9.0')
    assert.deepEqual(pkg.dependencies,lock.packages[''].dependencies);assert.deepEqual(pkg.devDependencies,lock.packages[''].devDependencies)
    assert.ok(source('docs/BUILD87_SEEK_THEME.md').includes('Build87'))
    assert.equal(pkg.scripts.postinstall,'node dependencies-patch.js');assert.ok(source('CHANGELOG.md').includes('iOS / iPadOS 1.9.0 Build 86'))
  })
  console.log(`${checks} upstream 1.9.0 behavioral/integration checks passed. External live APIs require separate device validation.`)
})().catch(e=>{console.error(e);process.exitCode=1})
