// Execute real facade, protected-resource and UI callback paths using bounded
// platform adapters. Apple/network/actual App gates remain separately required.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript')
const root = path.resolve(__dirname, '..'), read = p => fs.readFileSync(path.join(root, p), 'utf8')
const plain = x => JSON.parse(JSON.stringify(x))
const jsx = (type, props) => ({ type, props }), runtime = { jsx, jsxs: jsx, Fragment: 'Fragment' }
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children), ...(tree.type === 'FlatList' ? nodes(tree.props.data.map((item,index) => tree.props.renderItem({item,index}))) : [])] : []
const defer = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b }); return { promise, resolve, reject } }
const spin = async(work, message='did not settle') => { for(let i=0;i<150;i++){if(work())return;await new Promise(r=>setTimeout(r,1))}throw Error(message) }
function load(file, mocks = {}, extra = {}) {
  const output=ts.transpileModule(read(file), {fileName:file, reportDiagnostics:true, compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}})
  assert.equal((output.diagnostics||[]).filter(d=>d.category===1).length,0,file)
  const exports={};vm.runInNewContext(output.outputText,{exports,console,setTimeout,clearTimeout,setInterval,clearInterval,URL,Buffer,...extra,require: name=>{assert.ok(Object.hasOwn(mocks,name),'Unexpected dependency '+name+' in '+file);return mocks[name]}},{filename:file});return exports
}
const ref = load('src/core/library/reference.ts')
const account={id:'dav',name:'Home DAV',endpoint:'https://dav.invalid/',username:'user',allowHTTP:false,directoryCache:true,audioCache:true,revision:'r',passwordSaved:true}
const entries=[{name:'music.mp3',path:'music.mp3',directory:false,size:100,etag:'"test"'},{name:'folder',path:'folder',directory:true},{name:'bad.html',path:'bad.html',directory:false}]
const music=ref.entryMusic('dav',entries[0])
let count=0
const check=async(name,fn)=>{await fn();count++;console.log('PASS '+name)}
function uiFixture(page = 'library') {
  let cursor=0, pending=[], dirty=true, tree;const state=[],refs=[],effects=[],calls=[]
  const cfg={configuration:{schema:1,accounts:[account],audioLimitMB:512},error:'',busy:false}
  const queue={schema:1,enabled:false,initialized:true,quality:'320k',destination:{kind:'local'},jobs:[],error:''}
  const call=(name,value)=>{calls.push([name,plain(value??null)])}
  const operation=value=>({promise:Promise.resolve(value),cancel:()=>call('cancel')})
  const api={useLibrary:()=>cfg,useDownloadQueue:()=>queue,initializeLibrary:async()=>{},restoreStatus:async()=>({state:'none',message:''}),
    saveAccount:async value=>{call('saveAccount',value);return cfg.configuration},removeAccount:async id=>call('removeAccount',id),setCacheLimit:async n=>call('limit',n),clearCache:async k=>call('clear',k),
    browseDirectory:(id,p,force)=>{call('browse',{id,p,force});return operation(entries)},importEntries:async(...args)=>{call('import',args);return{id:'newlist',count:1}},
    createEncryptedBackup:async(...args)=>{call('backup',args.slice(0,3));return{path:'/private/backup.lxbackup',name:'backup.lxbackup',size:100,sha256:'a'.repeat(64),kind:args[0]}},
    stageEncryptedRestore:async(...args)=>{call('stage',args.slice(0,2));return{state:'prepared',id:'restore1',kind:'full',message:'staged'}},
    armRestore:async id=>{call('arm',id);return{state:'ready',id,kind:'full',message:'ready'}},cancelRestore:async id=>call('cancelRestore',id),
    uploadBackup:(...args)=>{call('upload',args.slice(0,3));return operation({path:'backup.lxbackup'})},fetchBackup:(...args)=>{call('fetchBackup',args.slice(0,2));return operation({path:'/private/backup.lxbackup'})},
    localDownloadPath:async p=>'/private/'+p,addPublished:async(...args)=>call('addPublished',args),
    downloadQueue:{setEnabled:async enabled=>{call('enabled',enabled);queue.enabled=enabled},configure:async value=>{call('configure',value);Object.assign(queue,value)},enqueue:async v=>call('enqueue',v),pauseAll:async()=>call('pauseAll'),pause:async id=>call('pause',id),retry:async id=>call('retry',id),remove:async id=>call('remove',id)}}
  const react={useState(initial){const i=cursor++;if(!(i in state))state[i]=typeof initial==='function'?initial():initial;return[state[i],v=>{state[i]=typeof v==='function'?v(state[i]):v;dirty=true}]},
    useRef(initial){const i=cursor++;refs[i]??={current:initial};return refs[i]},
    useEffect(fn,deps){const i=cursor++;if(!effects[i]||!deps||deps.some((v,j)=>!Object.is(effects[i].deps?.[j],v))){pending.push(()=>{effects[i]?.cleanup?.();effects[i]={deps,cleanup:fn()}})}}}
  const Native={FlatList:'FlatList',View:'View',ScrollView:'ScrollView',TouchableOpacity:'TouchableOpacity',TextInput:'TextInput',Switch:'Switch',Platform:{OS:'ios'},Alert:{alert(t,m,buttons){call('confirm',t);buttons.find(b=>b.text==='确认')?.onPress()}}}
  const Component=load(page === 'settings' ? 'src/screens/Home/Views/Setting/settings/Download/index.tsx' : page === 'downloads' ? 'src/screens/Home/Views/Library/Downloads.tsx' : page === 'toolbar' ? 'src/screens/Home/Views/Mylist/MyList/Toolbar.tsx' : 'src/screens/Home/Views/Library/index.tsx',{'react/jsx-runtime':runtime,react,'react-native':Native,
    '@/components/common/Text':{default:'Text'},'@/store/theme/hook':{useTheme:()=>({'c-main-background':'#161616','c-font':'#eee','c-button-font':'#6af'})},
    '@/store/list/hook':{useActiveListId:()=> 'personal',useMyList:()=>[{id:'personal',name:'Personal'}]},'@/core/list':{setActiveList:id=>call('activeList',id),getListMusics:async id=>{call('getList',id);return[music]}},
    '@/utils/fs':{selectFile:async()=>({path:'/private/backup.lxbackup'})},'@/utils/nativeModules/utils':{shareFile:async(...args)=>call('share',args)},
    '@/core/library':api,'@/core/library/reference':ref,
    '@/core/common':{setNavActiveId:id=>call('nav',id)}, '@/core/library/page':{useLibraryPage:()=>({tab:'webdav',listId:'default',revision:0}),openLibraryPage:(...args)=>call('page',args)},
    './Downloads':{default:'Downloads'}, '@/components/common/Button':{default:'Button'}, '@/components/MusicAddModal':{default:'MusicAddModal'},
    '../../components/Section':{default:'Section'}, '../../components/SubTitle':{default:'SubTitle'}, '../../components/CheckBoxItem':{default:'CheckBoxItem'} }).default
  function render(){cursor=0;dirty=false;tree=Component(page === 'toolbar' ? {onNew:()=>call('createFromMyLists')} : {});const run=pending;pending=[];run.forEach(f=>f());return tree}
  async function flush(){for(let i=0;i<8;i++){if(dirty||!tree)render();await new Promise(resolve=>setImmediate(resolve))}if(dirty)render()}
  function by(id){return nodes(tree).find(n=>n.props?.id===id||n.props?.testID===id)}
  function button(label){return nodes(tree).find(n=>n.props?.title===label||n.props?.label===label)}
  async function press(value){const n=typeof value==='string'?by(value)||button(value):value;assert.ok(n,'button not found '+value);assert.ok(!n.props.disabled,'button disabled '+value);n.props.onPress();await flush()}
  async function field(id,value){const n=by(id)||nodes(tree).find(n=>n.props?.label===id);assert.ok(n,'field missing '+id);(n.props.onChange ?? n.props.onValueChange)(value);await flush()}
  return {calls,cfg,queue,api,flush,render,by,button,press,field,get tree(){return tree},unmount(){effects.forEach(e=>e?.cleanup?.())}}
}
;(async()=>{
  await check('opaque song records round-trip without account credentials or remote authenticated URLs',()=>{assert.equal(ref.decodeLibraryURL(music.meta.filePath).path,'music.mp3');assert.ok(!music.meta.filePath.includes('dav.invalid'));assert.equal(music.source,'local');assert.throws(()=>ref.decodeLibraryURL('https://user:password@server'));assert.equal(ref.supportedAudio('some.html'),false)})
  await check('shared UI uses theme background and exposes all three real feature sections',async()=>{const f=uiFixture();await f.flush();assert.equal(f.tree.props.style.backgroundColor,'#161616');for(const id of ['library-tab-webdav','library-tab-downloads','library-tab-backup'])assert.ok(f.by(id));f.unmount()})
  await check('account editor keeps passwords secure and cache switches independent',async()=>{const f=uiFixture();await f.flush();await f.press('编辑当前账户');assert.equal(f.by('library-account-password').props.secure,true);await f.field('library-directory-cache',false);assert.equal(f.by('library-audio-cache').props.value,true);await f.press('library-account-save');const saved=f.calls.find(c=>c[0]==='saveAccount')[1];assert.equal(saved.directoryCache,false);assert.equal(saved.audioCache,true);assert.ok(!('password'in saved));f.unmount()})
  await check('new account password is passed only when explicitly edited then cleared from UI',async()=>{const f=uiFixture();await f.flush();await f.press('library-account-add');await f.field('library-account-endpoint','https://new.invalid/dav');await f.field('library-account-password','test-password');await f.press('library-account-save');assert.equal(f.calls.find(c=>c[0]==='saveAccount')[1].password,'test-password');assert.equal(f.by('library-account-editor'),undefined);f.unmount()})
  await check('directory selection imports supported audio, not folders/HTML, into selected real list',async()=>{const f=uiFixture();await f.flush();await f.press('全选当前目录音频');await f.press('library-import');const args=f.calls.find(c=>c[0]==='import')[1];assert.equal(args[0],'dav');assert.equal(args[2],'default');assert.deepEqual(args[1].map(e=>e.name),['music.mp3']);f.unmount()})
  await check('manual refresh bypasses directory cache and cache clearing stays separately scoped',async()=>{const f=uiFixture();await f.flush();await f.press('library-directory-refresh');assert.equal(f.calls.filter(c=>c[0]==='browse').at(-1)[1].force,true);await f.press('清除目录缓存');await f.press('清除音频缓存');assert.deepEqual(f.calls.filter(c=>c[0]==='clear').map(c=>c[1]),['directory','audio']);f.unmount()})
  await check('credential edits await cancellation of an older directory operation',async()=>{
    const f=uiFixture(), pending=defer();let cancelled=false
    f.api.browseDirectory=()=>({promise:pending.promise,cancel:()=>{cancelled=true}})
    await f.flush();await f.press('编辑当前账户');await f.field('library-account-password','changed-password');await f.press('library-account-save')
    assert.equal(cancelled,true);assert.ok(!f.calls.some(c=>c[0]==='saveAccount'))
    pending.resolve(entries);await f.flush();assert.equal(f.calls.find(c=>c[0]==='saveAccount')[1].password,'changed-password');f.unmount()
  })
  await check('download configuration is in Settings and is absent from the task page',async()=>{
    const f=uiFixture('settings');await f.flush();assert.equal(f.by('library-download-enabled').props.value,false);await f.field('library-download-enabled',true);assert.deepEqual(f.calls.find(c=>c[0]==='enabled'),['enabled',true]);f.unmount()
    const page=uiFixture('downloads');await page.flush();assert.equal(page.by('library-download-enabled'),undefined);assert.equal(page.by('download-settings-folder'),undefined);assert.ok(page.by('download-records'));await page.press('download-settings-link');assert.deepEqual(page.calls.find(c=>c[0]==='nav'),['nav','nav_setting']);page.unmount()
  })
  await check('Settings quality and destinations update the durable queue',async()=>{
    const f=uiFixture('settings');await f.flush();const q=f.button('flac');assert.ok(q);q.props.onChange();await f.flush();await f.press('download-settings-save-dav');const local=f.button('本机 / LX Downloads');local.props.onChange();await f.flush();assert.deepEqual(f.calls.filter(c=>c[0]==='configure').map(c=>c[1]),[{quality:'flac'},{destination:{kind:'webdav',accountId:'dav',path:'LX Music'}},{destination:{kind:'local'}}]);f.unmount()
  })
  await check('task page separates active progress from history and binds pause/retry to real job IDs',async()=>{
    const f=uiFixture('downloads');f.queue.enabled=true;f.queue.jobs=[{id:'job1',music,quality:'320k',destination:{kind:'local'},status:'downloading',received:3,total:10},{id:'job2',music,quality:'320k',destination:{kind:'local'},status:'paused',received:1,total:10},{id:'done',music,quality:'320k',destination:{kind:'local'},status:'completed',received:10,total:10}];await f.flush();assert.ok(f.by('download-progress-job1'));assert.equal(f.by('download-progress-job1').props.accessibilityValue.now,30);assert.equal(f.by('library-job-done'),undefined);await f.press('download-pause-job1');await f.press('download-retry-job2');assert.deepEqual(f.calls.filter(c=>['pause','retry'].includes(c[0])),[['pause','job1'],['retry','job2']]);await f.press('download-history-tab');assert.ok(f.by('library-job-done'));assert.equal(f.by('library-job-job1'),undefined);f.unmount()
  })
  await check('My Lists owns creation and passes its selected list to WebDAV import',async()=>{
    const f=uiFixture('toolbar');await f.flush();await f.press('mylist-create');await f.press('mylist-webdav-import');assert.ok(f.calls.some(c=>c[0]==='createFromMyLists'));assert.deepEqual(f.calls.find(c=>c[0]==='page'),['page',['webdav','personal']]);f.unmount()
    const dav=uiFixture();await dav.flush();assert.equal(dav.button('新建歌单并导入'),undefined);assert.ok(!nodes(dav.tree).some(n=>n.props?.label==='新建歌单名称'));dav.unmount()
  })
  await check('backup rejects mismatched password before calling the native encrypted backup',async()=>{const f=uiFixture();await f.flush();await f.press('library-tab-backup');await f.field('library-backup-password','valid-test-password');await f.press('library-backup-create');assert.ok(!f.calls.some(c=>c[0]==='backup'));assert.ok(f.by('library-message'));f.unmount()})
  await check('full/playlist selection and secure passphrase invoke actual backup facade and clear inputs',async()=>{const f=uiFixture();await f.flush();await f.press('library-tab-backup');await f.field('library-backup-password','valid-test-password');await f.field('再次输入密码（创建备份时必填）','valid-test-password');await f.press('全部歌单');await f.press('library-backup-create');assert.deepEqual(f.calls.find(c=>c[0]==='backup')[1],['playlists','valid-test-password',true]);assert.equal(f.by('library-backup-password').props.value,'');assert.equal(f.by('library-backup-password').props.secure,true);f.unmount()})
  await check('restore stages first and requires explicit confirmation before arming cold replacement',async()=>{const f=uiFixture();await f.flush();await f.press('library-tab-backup');await f.press('选择本地加密备份');await f.field('library-backup-password','restore-passphrase');await f.press('library-restore-stage');assert.deepEqual(f.calls.find(c=>c[0]==='stage')[1],['/private/backup.lxbackup','restore-passphrase']);assert.ok(!f.calls.some(c=>c[0]==='arm'));await f.press('library-restore-arm');assert.ok(f.calls.some(c=>c[0]==='confirm'));assert.deepEqual(f.calls.find(c=>c[0]==='arm'),['arm','restore1']);f.unmount()})
  await check('real queue facade routes fresh online URLs, protected DAV references and local file destinations',async()=>{
    let deps,seq=0;const calls=[],events={},config={schema:1,accounts:[account],audioLimitMB:512},state={enabled:false}
    class Queue{constructor(value){deps=value}subscribe(fn){this.change=fn;return()=>{}}async initialize(){}snapshot(){return state}progress(){}async pauseAll(){calls.push('pauseAll')}async suspend(){calls.push('queueHold');return()=>calls.push('queueRelease')}async enqueue(values){calls.push(['enqueue',plain(values)])}}
    const api=load('src/core/library/index.ts',{'react-native':{AppState:{addEventListener:(name,fn)=>{events[name]=fn}}},react:{useEffect(){},useState(){}},'./DownloadQueue':{DownloadQueue:Queue},'./reference':ref,
      './native':{available:()=>true,nativeCommand:async(command,payload)=>{calls.push([command,plain(payload??{})]);if(command==='config.read')return config;if(command==='file.local')return'/inside/download';if(command==='download.run')return{}},observeProgress:()=>()=>{},operationId:()=>`op${++seq}`,cancelOperation:()=>{}},
      '@/core/music':{getMusicUrlInfo:async args=>{calls.push(['resolve',plain(args)]);return{url:'https://public.invalid/media?ephemeral=1'}}},
      '@/core/list':{addListMusics:async(...args)=>calls.push(['add',plain(args)]),getUserLists:async()=>[{id:'personal',name:'Personal'}]},'./page':{openLibraryPage:()=>{}},
      '@/plugins/storage':{withStorageSnapshot:async task=>{calls.push('storageHold');try{return await task()}finally{calls.push('storageRelease')}}},
      '@/core/player/player':{pause:async()=>calls.push('playerPause')},'@/core/common':{setNavActiveId(){}},'@/utils/tools':{toast(){}}},
      {global:{lx:{},list_event:{list_data_withSnapshot:async task=>{calls.push('listHold');try{return await task()}finally{calls.push('listRelease')}}}}})
    await api.initializeLibrary();const remote={id:'online',source:'kw',name:'Online',meta:{songId:'online'}}
    await deps.resolve({music:remote,quality:'flac'});const args=calls.find(c=>Array.isArray(c)&&c[0]==='resolve')[1];assert.equal(args.isRefresh,true);assert.equal(args.cacheAudio,false);assert.equal(args.allowToggleSource,false)
    assert.equal((await deps.resolve({music,quality:'320k'})).kind,'webdav');assert.equal(calls.filter(c=>Array.isArray(c)&&c[0]==='resolve').length,1)
    await api.importEntries('dav',entries,'personal');assert.equal(calls.find(c=>Array.isArray(c)&&c[0]==='add')[1][0],'personal');await assert.rejects(api.importEntries('dav',entries,undefined),/我的列表/);assert.ok(!calls.some(c=>Array.isArray(c)&&c[0]==='create'))
    calls.length=0;await api.createEncryptedBackup('full','passphrase',true)
    assert.deepEqual(calls.filter(c=>typeof c==='string'),['queueHold','playerPause','listHold','storageHold','storageRelease','listRelease','queueRelease'])
    assert.equal(calls.find(c=>Array.isArray(c)&&c[0]==='backup.create')[1].kind,'full');events.change('background');await Promise.resolve();assert.ok(calls.includes('pauseAll'))
  })
  await check('all native services are actually registered and cold restore precedes bridge creation',()=>{
    const project=read('ios/LxMusicMobile.xcodeproj/project.pbxproj')
    for(const file of ['LXLibrarySupport.swift','LXWebDAVCore.swift','LXResumableTransfer.swift','LXPortableBackup.swift','LXStorageSnapshot.swift','LXRestoreCoordinator.swift','LXLibraryWorker.swift','LXLibraryServices.swift','LXLibraryServicesBridge.m'])assert.ok(project.includes(file+' in Sources'),file)
    const native=read('ios/LxMusicMobile/AppDelegate.mm');require('./native-build88-preservation').legacyNativeSource(native)
    const hook=native.slice(native.indexOf('- (void)startReactNativeWithLaunchOptions:(NSDictionary *)launchOptions\n{'))
    assert.ok(hook.indexOf('[LXRestoreBootstrap prepare:')<hook.indexOf('RCTBridge *bridge'))
    assert.ok(hook.includes('if (starting) return'));assert.ok(read('src/core/init/index.ts').includes('await acknowledgeRestore()'))
    assert.ok(read('src/plugins/player/engine/resourceLoader.ts').includes('prepareLibraryPlayback(decodeLibraryURL(args.url))'))
    for(const token of ['AES.GCM.seal','AES.GCM.open','CCKeyDerivationPBKDF'])assert.ok(read('ios/LxMusicMobile/LXPortableBackup.swift').includes(token))
  })
  await check('full player queue, original cache engine, native audio and sync protocol bytes remain protected',()=>{
    const crypto=require('node:crypto'),baseline=JSON.parse(read('docs/BUILD86_BASELINE_HASHES.json'))
    for(const[file,hash]of Object.entries(baseline)){const data=file.endsWith('AppDelegate.mm')?require('./native-build88-preservation').legacyNativeSource(read(file)):read(file);assert.equal(crypto.createHash('sha256').update(data).digest('hex'),hash,file)}
    const expected=JSON.parse(read('scripts/build88-preserved-files.json'));for(const[file,hash]of Object.entries(expected))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex'),hash,file)
  })
  console.log(`${count} library production facade/UI/registration/preservation groups passed. Real Apple and App gates remain mandatory.`)
})().catch(error=>{console.error(error);process.exitCode=1})
