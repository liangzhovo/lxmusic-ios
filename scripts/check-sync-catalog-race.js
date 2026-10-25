// Deterministic reproduction of the real AsyncStorage delete-then-write window.
// Exercise the production storage, list manager and event queue, not a success stub.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),ts=require('typescript')
const root=path.resolve(__dirname,'..')
const plain=x=>JSON.parse(JSON.stringify(x))
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}}
function load(file,mocks,global){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{fileName:file,compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require:n=>{assert.ok(n in mocks,`${file}: ${n}`);return mocks[n]},global,console,setTimeout,clearTimeout});return exports}
function setup(initial=[]){
 const disk=new Map([['users',JSON.stringify(initial)]]);let gap=null,reads=0,delayedRead=null
 const native={getItem:async key=>{if(key==='users'){reads++;if(delayedRead){const task=delayedRead;delayedRead=null;return task.promise}}return disk.get(key)??null},
  removeItem:async key=>{disk.delete(key);if(key==='users'&&gap){gap.enter.resolve();await gap.leave.promise}},
  multiSet:async data=>{for(const[k,v]of data)disk.set(k,v)},multiGet:async keys=>keys.map(k=>[k,disk.get(k)??null]),multiRemove:async keys=>{for(const k of keys)disk.delete(k)}}
 const storage=load('src/plugins/storage.ts',{'@react-native-async-storage/async-storage':{default:native},'@/utils/log':{log:{error(){}}}}, {})
 const data={getUserLists:async()=>await storage.getData('users')??[],getListMusics:async id=>await storage.getData('music/'+id)??[],
  saveUserList:lists=>storage.saveData('users',lists),saveListMusics:items=>Promise.all(items.map(x=>storage.saveData('music/'+x.id,x.musics))),
  removeListMusics:ids=>Promise.all(ids.map(id=>storage.removeData('music/'+id))),overwriteListPosition:async()=>{},overwriteListUpdateInfo:async()=>{},removeListPosition:async()=>{},removeListUpdateInfo:async()=>{}}
 const constants={LIST_IDS:{DEFAULT:'default',LOVE:'love',TEMP:'temp'}}
 const manager=load('src/utils/listManage.ts',{'@/utils/data':data,'@/utils/common':{arrPush:(a,b)=>a.push(...b),arrUnshift:(a,b)=>a.unshift(...b),arrPushByPosition:(a,b,i)=>a.splice(i,0,...b)},'@/config/constant':constants},{})
 const global={app_event:{myListMusicUpdate(){}}};const state={activeListId:'default',allList:[]}
 const {ListEvent}=load('src/event/listEvent.ts',{'./Event':{default:class{emit(){}}},'@/utils/data':data,'@/utils/listManage':manager,'@/config/constant':constants,'@/core/list':{setUserList:lists=>{state.allList=[...lists]},setActiveList:id=>{state.activeListId=id}},'@/store/list/state':{default:state},'@/utils/libraryBootstrap':{LOCAL_LIBRARY_ID:'local',markLibraryInitialized:async()=>{}}},global)
 const hub=global.list_event=new ListEvent()
 const sync=load('src/plugins/sync/listEvent.ts',{'@/config/constant':constants,'@/core/list':{getListMusics:manager.getListMusics},'@/utils/listManage':manager},global)
 return{disk,manager,hub,sync,reads:()=>reads,startGap(){gap={enter:deferred(),leave:deferred()};return gap},endGap(){gap.leave.resolve();gap=null},holdRead(){return delayedRead=deferred()}}
}
let count=0
const check=async(name,fn)=>{await fn();console.log('PASS '+name);count++}
;(async()=>{
 await check('metadata lookup during remove-before-save does not erase surviving lists',async()=>{
  const {manager,hub,disk,startGap,endGap}=setup([{id:'keep',name:'PC已重命名'},{id:'remove',name:'delete'}]);await manager.getUserLists()
  const gap=startGap(),removing=hub.list_remove(['remove']);await gap.enter.promise
  assert.equal(disk.has('users'),false,'test must hit actual storage publication gap')
  const visible=plain(await manager.getUserLists());endGap();await removing
  assert.deepEqual(visible.map(x=>x.id),['keep']);assert.equal(manager.isListAvailable('keep'),true)
  assert.deepEqual(plain(await manager.getUserLists()).map(x=>x.id),['keep'])
 })
 await check('concurrent startup readers share one hydration',async()=>{
  const s=setup([{id:'keep',name:'stable'}]);await Promise.all([s.manager.getUserLists(),s.manager.getUserLists(),s.manager.getUserLists()]);assert.equal(s.reads(),1)
 })
 await check('late startup disk result cannot replace explicitly updated metadata',async()=>{
  const s=setup(),pending=s.holdRead(),reading=s.manager.getUserLists();s.manager.setUserLists([{id:'fresh',name:'New'}]);pending.resolve(JSON.stringify([{id:'old',name:'Old'}]));await reading
  assert.deepEqual(plain(s.manager.userLists).map(x=>x.id),['fresh'])
 })
 await check('sync snapshot waits for durable mutations and never sees transient empty metadata',async()=>{
  const s=setup([{id:'keep',name:'Kept'},{id:'remove',name:'Remove'}]);await s.manager.getUserLists();await s.hub.list_music_overwrite('keep',[{id:'a'}])
  const gap=s.startGap(),removing=s.hub.list_remove(['remove']);await gap.enter.promise
  let done=false;const read=s.sync.getLocalListData().then(x=>{done=true;return x});await Promise.resolve();await Promise.resolve();assert.equal(done,false)
  s.endGap();await removing;const snapshot=await read;assert.deepEqual(plain(snapshot.userList).map(x=>x.id),['keep']);assert.deepEqual(plain(snapshot.userList[0].list),[{id:'a'}])
  await s.hub.list_music_add('keep',[{id:'b'}],'bottom');assert.deepEqual(plain(snapshot.userList[0].list),[{id:'a'}],'published snapshot must not alias mutable songs')
 })
 await check('reconnect-shaped reads preserve peer edits, and cold hydration recovers durable contents',async()=>{
  const s=setup();await s.manager.getUserLists();await s.hub.list_create(0,[{id:'peer',name:'PC原名'}]);await s.hub.list_music_add('peer',[{id:'tone'}],'bottom')
  await s.hub.list_update([{id:'peer',name:'PC已重命名'}]);const before=plain(await s.sync.getLocalListData());await s.hub.list_data_overwrite(before,true)
  await s.hub.list_music_add('peer',[{id:'reconnect'}],'bottom');assert.equal((await s.manager.getUserLists())[0].name,'PC已重命名')
  const cold=setup(JSON.parse(s.disk.get('users')));for(const[k,v]of s.disk)cold.disk.set(k,v);const recovered=plain(await cold.sync.getLocalListData())
  assert.equal(recovered.userList[0].name,'PC已重命名');assert.equal(recovered.userList[0].list.length,2)
 })
 await check('deleted list still rejects late actions; snapshot queue recovers after rejection',async()=>{
  const s=setup([{id:'gone',name:'Delete'}]);await s.manager.getUserLists();await s.hub.list_remove(['gone']);await assert.rejects(s.hub.list_music_add('gone',[{id:'late'}],'bottom'),/列表已移除/)
  assert.deepEqual(plain(await s.sync.getLocalListData()).userList,[])
 })
 console.log(`${count} production storage/catalog/sync race checks passed.`)
})().catch(error=>{console.error(error);process.exitCode=1})
