// Real list files + isolated module instances; native audio/UI have a separate CI gate.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const vm = require('node:vm'), assert = require('node:assert/strict'), ts = require('typescript')
const root = path.resolve(__dirname, '..')
const source = p => fs.readFileSync(path.join(root, p), 'utf8')
const load = (file, mocks = {}, globals = {}) => {
  const exports = {}
  const code = ts.transpileModule(source(file), {fileName:file,compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText
  vm.runInNewContext(code, {exports,require:n=>{if(n in mocks)return mocks[n];throw Error(`Missing mock ${n} (${file})`)},console,setTimeout,clearTimeout,...globals})
  return exports
}
let total=0
const check=async(name,fn)=>{await fn();total++;console.log(`PASS ${name}`)}
const clone = obj => JSON.parse(JSON.stringify(obj))
;(async()=>{
  const read=load('src/utils/readability.ts')
  await check('body and metadata larger without changing zero-size text',()=>{
    assert.equal(read.readableTextSize(15),17);assert.equal(read.readableTextSize(14),16)
    assert.equal(read.readableTextSize(10),13);assert.equal(read.readableTextSize(0),0)
  })
  await check('built-in light/dark semantic foreground contrast including tinted buttons',()=>{
    const themes=load('src/theme/themes/themes.ts').default
    for(const item of themes){
      const c=item.config.themeColors
      const t=read.readableTheme({'c-content-background':c['c-primary-light-1000'],'c-font':c['c-850'],'c-font-label':c['c-450'],
        'c-primary-font':c['c-primary'],'c-button-font':c['c-primary-alpha-100'],'c-button-background':c['c-primary-light-400-alpha-700']})
      assert.ok(read.contrastRatio(t['c-font'],t['c-content-background'])>=7,item.id)
      assert.ok(read.contrastRatio(t['c-font-label'],t['c-content-background'])>=5,item.id)
      assert.ok(read.contrastRatio(t['c-primary-font'],t['c-content-background'])>=4.5,item.id)
      assert.ok(read.contrastRatio(t['c-button-font'],read.compositeColor(t['c-button-background'],t['c-content-background']))>=5,item.id)
    }
    console.log(`  checked ${themes.length} shipped palettes`)
  })
  const panel=load('src/utils/panelLayout.ts')
  await check('only the player playlist overrides position; all other callers retain their design',()=>{
    for(const pos of ['top','bottom','right','left','center']){
      assert.equal(panel.panelPosition(true,'player-playlist',pos),'left')
      assert.equal(panel.panelPosition(true,'list',pos),pos)
      assert.equal(panel.panelPosition(true,'panel',pos),pos)
      assert.equal(panel.panelPosition(false,'panel',pos),pos)
    }
  })
  await check('consistent bounded list panel for full, narrow and keyboard-reduced windows',()=>{
    assert.deepEqual(clone(panel.panelBounds(1366,960,'list')),{width:420,height:600})
    for(const [w,h] of [[1366,960],[744,600],[390,720],[320,240],[240,180],[0,0]]){
      const a=panel.panelBounds(w,h,'list'),b=panel.panelBounds(w,h,'list')
      assert.deepEqual(a,b);assert.ok(a.width<=420&&a.height<=600)
      assert.ok(a.width<=Math.max(0,w-24)&&a.height<=Math.max(0,h-24));assert.ok(a.width>=0&&a.height>=0)
    }
  })
  await check('favorites grid uses dialog width, one to three columns, without overflow',()=>{
    for(const width of [280,320,390,560,680]){
      const grid=panel.listGridLayout(width)
      assert.ok(grid.columns>=1&&grid.columns<=3)
      assert.ok(grid.columns*grid.itemWidth<=width-20+0.001)
    }
    assert.equal(panel.listGridLayout(680).columns,3)
    assert.equal(panel.listGridLayout(320).columns,1)
    for(const p of ['MusicAddModal','MusicMultiAddModal']){
      assert.ok(!source(`src/components/${p}/List.tsx`).includes('windowSize.width'))
      assert.ok(source(`src/components/${p}/${p}.tsx`).includes('maxWidth={680}'))
    }
  })
  const {VolumeInteraction}=load('src/plugins/player/volumeInteraction.ts')
  await check('mount/programmatic slider callbacks cannot attenuate saved audio gain',()=>{
    const g=new VolumeInteraction()
    for(const n of [0,1,40,100]){assert.equal(g.change(n),null);assert.equal(g.finish(n),null)}
    g.start();assert.equal(g.change(50),0.5);assert.equal(g.finish(100),1)
    assert.equal(g.change(0),null);assert.equal(g.finish(0),null)
  })
  await check('explicit volume clamps safely; cancel and repeated completion are inert',()=>{
    const g=new VolumeInteraction();g.start()
    assert.equal(g.change(-1),0);assert.equal(g.change(999),1);assert.equal(g.change(NaN),null)
    assert.equal(g.cancel(),true);assert.equal(g.cancel(),false);assert.equal(g.finish(0),null)
  })
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lx-list80-'))
  const file=k=>path.join(dir,encodeURIComponent(k)+'.json')
  const get=k=>fs.existsSync(file(k))?JSON.parse(fs.readFileSync(file(k),'utf8')):null
  const put=(k,v)=>fs.writeFileSync(file(k),JSON.stringify(v))
  const storage={getData:async k=>get(k),saveData:async(k,v)=>put(k,v)}
  const bootstrap=load('src/utils/libraryBootstrap.ts',{'@/plugins/storage':storage})
  const ids={DEFAULT:'default',LOVE:'love',TEMP:'temp'}
  let pendingRead=null
  const data={getUserLists:async()=>get('users')||[],getListMusics:async id=>pendingRead?pendingRead(id):get('music/'+id)||[],
    overwriteListPosition:async()=>{},overwriteListUpdateInfo:async()=>{},removeListPosition:async()=>{},removeListUpdateInfo:async()=>{},
    saveUserList:async lists=>{const copy=clone(lists);await new Promise(r=>setTimeout(r,5));put('users',copy)},
    removeListMusics:async list=>{for(const id of list)fs.rmSync(file('music/'+id),{force:true})},
    saveListMusics:async list=>{for(const item of list)put('music/'+item.id,item.musics)}}
  const managerMocks={'@/utils/data':data,'@/config/constant':{LIST_IDS:ids},'@/utils/common':{
    arrPush:(a,b)=>a.push(...b),arrUnshift:(a,b)=>a.unshift(...b),arrPushByPosition:(a,b,pos)=>a.splice(pos,0,...b)}}
  const manager=load('src/utils/listManage.ts',managerMocks)
  const state={activeListId:ids.DEFAULT,allList:[{id:ids.DEFAULT},{id:ids.LOVE}]}
  const app={myListMusicUpdate:()=>{}}
  const {ListEvent}=load('src/event/listEvent.ts',{'./Event':{default:class{emit(){}}},'@/utils/data':data,
    '@/utils/listManage':manager,'@/config/constant':{LIST_IDS:ids},'@/utils/libraryBootstrap':bootstrap,
    '@/store/list/state':{default:state},'@/core/list':{setUserList:lists=>{state.allList=[{id:ids.DEFAULT},{id:ids.LOVE},...lists]},setActiveList:id=>{state.activeListId=id}}},
    {global:{app_event:app}})
  const hub=new ListEvent()
  try{
    await check('remove never-opened user list updates durable metadata and active selection',async()=>{
      await hub.list_create(0,[{id:'unopened',name:'Unopened',locationUpdateTime:null}])
      state.activeListId='unopened';await hub.list_remove(['unopened'])
      assert.equal(get('users').length,0);assert.equal(state.activeListId,ids.DEFAULT)
      const restarted=load('src/utils/listManage.ts',managerMocks)
      assert.equal((await restarted.getUserLists()).length,0)
    })
    await check('local library is created once and remains removed across bootstrap/restart',async()=>{
      let creations=0
      const boot=async()=>bootstrap.bootstrapLibrary(()=>manager.userLists.some(l=>l.id===bootstrap.LOCAL_LIBRARY_ID),async()=>{
        creations++;await hub.list_create(0,[{id:bootstrap.LOCAL_LIBRARY_ID,name:'本地音乐',locationUpdateTime:null}])})
      await boot();await hub.list_remove([bootstrap.LOCAL_LIBRARY_ID]);await boot()
      const restartedBootstrap=load('src/utils/libraryBootstrap.ts',{'@/plugins/storage':storage})
      await restartedBootstrap.bootstrapLibrary(()=>false,async()=>{creations++})
      assert.equal(creations,1);assert.equal(get('users').length,0)
      assert.ok(!source('src/screens/Home/Views/Mylist/index.tsx').includes('createList('))
    })
    await check('concurrent music write then removal is serialized; late sync cannot resurrect',async()=>{
      await hub.list_create(0,[{id:'race',name:'Race',locationUpdateTime:null}])
      await Promise.all([hub.list_music_add('race',[{id:'tone'}],'bottom'),hub.list_remove(['race'])])
      assert.equal(get('music/race'),null);assert.equal(get('users').length,0)
      await assert.rejects(hub.list_music_overwrite('race',[{id:'late'}]),/列表已移除/)
      assert.equal(get('music/race'),null)
      await hub.list_create(0,[{id:'next',name:'Next',locationUpdateTime:null}]) // queue recovers from rejected operation
      assert.equal(get('users')[0].id,'next')
    })
    await check('song removal is persistent after cache and module recreation',async()=>{
      await hub.list_music_add('next',[{id:'one'},{id:'two'}],'bottom')
      await hub.list_music_remove('next',['one'])
      const restarted=load('src/utils/listManage.ts',managerMocks);await restarted.getUserLists()
      assert.deepEqual(clone(await restarted.getListMusics('next')),[{id:'two'}])
    })
    await check('in-flight old disk read cannot republish removed music list',async()=>{
      await hub.list_create(0,[{id:'slow',name:'Slow',locationUpdateTime:null}])
      let release;pendingRead=()=>new Promise(r=>release=r)
      const loading=manager.getListMusics('slow')
      await hub.list_remove(['slow']);release([{id:'stale'}]);await loading
      assert.equal(manager.allMusicList.has('slow'),false);pendingRead=null
    })
    await check('built-in lists survive invalid removal requests',async()=>{
      await hub.list_music_overwrite(ids.LOVE,[{id:'favorite'}])
      await hub.list_remove([ids.LOVE,ids.DEFAULT])
      assert.deepEqual(get('music/'+ids.LOVE),[{id:'favorite'}])
    })
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
  await check('table header shares column component and stays outside scroll body',()=>{
    const header=source('src/components/common/SongTableHeader.tsx')
    for(const label of ['歌曲名','艺术家','专辑名','时长','操作'])assert.ok(header.includes(label),label)
    for(const p of ['src/components/OnlineList/List.tsx','src/screens/Home/Views/Mylist/MusicList/List.tsx']){
      const s=source(p);assert.ok(s.indexOf('<SongTableHeader')<s.indexOf('<FlatList\n'))
    }
    assert.ok(source('src/screens/PlayDetail/Horizontal/components/PlaylistBtn.tsx').includes('<SongRowContent'))
    assert.ok(source('src/screens/PlayDetail/Horizontal/components/PlaylistBtn.tsx').includes('getItemLayout='))
  })
  await check('no hidden gain multiplier; explicit unity mixer and real PCM measurement gate',()=>{
    const native=source('ios/LxMusicMobile/AppDelegate.mm')
    assert.ok(native.includes('mainMixerNode.outputVolume = 1.0f'))
    assert.ok(native.includes('fromBus:0 toBus:1 format:self.outputFormat'))
    assert.ok(native.includes('installTapOnBus:0'))
    assert.ok(source('src/tests/playbackSmoke.tsx').includes('metrics.rms / fullRMS'))
    assert.ok(source('src/plugins/player/soundEffect/controller.ts').includes("setting['player.soundEffect.enabled'] &&"))
  })
  await check('version-specific repair summary exists in project CHANGELOG',()=>{
    const pkg=JSON.parse(source('package.json'))
    assert.ok(source(`CHANGELOG_BUILD${pkg.versionCode}.md`).includes(`iOS / iPadOS ${pkg.version} Build ${pkg.versionCode}`))
  })
  console.log(`${total} Build 80 checks passed. Real native output and rendered UI have separate evidence.`)
})().catch(e=>{console.error(e);process.exitCode=1})
