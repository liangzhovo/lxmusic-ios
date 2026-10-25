import { expectSyncFailure } from './expectedSyncFailure'
import { getSyncDiagnostic } from '@/plugins/sync/diagnostics'
import { Buffer as PortableBuffer } from 'buffer'
import { Buffer as AppBuffer } from '@craftzdog/react-native-buffer'
import { NativeModules } from 'react-native'
import { aesEncrypt, aesDecrypt } from '@/plugins/sync/utils'
import { encryptMsg, decryptMsg } from '@/plugins/sync/client/utils'
// Loaded only by the simulator test harness. Uses real RN HTTP/WebSocket,
// CryptoModule, persistent storage and the unchanged official sync server.
import { connectServer, disconnectServer, getStatus } from '@/plugins/sync'
import { normalizeSyncAddress } from '@/plugins/sync/address'
import { SYNC_CODE } from '@/plugins/sync/constants'
import { createList, removeUserList, addListMusics, removeListMusics, updateUserList, getListMusics, getUserLists } from '@/core/list'
import syncState from '@/store/sync/state'
import { Navigation } from 'react-native-navigation'
import SyncModeModal from '@/navigation/components/SyncModeModal'
import { SYNC_MODE_MODAL } from '@/navigation/screenNames'
import { Provider } from '@/store/Provider'
import React from 'react'
import { removeSyncModeEvent } from '@/core/sync'

type Check = (name: string, fn: () => Promise<unknown>) => Promise<void>
const sleep = async(ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const wait = async(fn: () => Promise<boolean> | boolean, label: string) => {
  const start=Date.now()
  while(Date.now()-start<14000){if(await fn())return;await sleep(150)}
  throw new Error(label + ': ' + getStatus().message)
}
const assert = (condition: unknown, message: string) => { if(!condition) throw new Error(message) }
const api = async(path: string, data?: unknown): Promise<any> => {
  const response=await fetch('http://127.0.0.1:18781'+path,{method:data === undefined?'GET':'POST',headers:{'Content-Type':'application/json'},body:data === undefined?undefined:JSON.stringify(data)})
  const result=await response.json()
  if(!response.ok)throw new Error(JSON.stringify(result))
  return result
}
const song = (id: string): LX.Music.MusicInfoOnline => ({id,name:'中文同步 '+id,singer:'测试歌手',source:'kw',interval:'04:10',meta:{songId:id,albumName:'同步验证',picUrl:'',qualitys:[],_qualitys:{}}} as LX.Music.MusicInfoOnline)
const address = normalizeSyncAddress(' 127.0.0.1:18780/ ')
export const runSyncSmoke = async(check: Check, offline: boolean) => {
  Navigation.registerComponent(SYNC_MODE_MODAL, () => (props: { componentId: string }) => React.createElement(Provider, null, React.createElement(SyncModeModal, props)))
  const choose = setInterval(() => {
    // Never used outside the synthetic CI process. A real user must choose.
    if(syncState.syncModeComponentId) global.app_event.selectSyncMode({type:syncState.type,mode:'merge_local_remote'} as LX.Sync.ModeType)
  }, 350)
  try {
    await check('sync: installed codec and async native bridge contract', async() => {
      const methods = ['generateRsaKey', 'aesEncrypt', 'aesDecrypt', 'rsaDecrypt']
      for (const method of methods) assert(typeof NativeModules.CryptoModule?.[method] == 'function', `CryptoModule.${method} is missing`)
      const unicode = 'LX Unicode 中文 🌸', encoded = PortableBuffer.from(unicode, 'utf8').toString('base64')
      assert(AppBuffer.from(encoded, 'base64').toString('utf8') == unicode, 'App Buffer/Base64 native package mismatch')
      const key = PortableBuffer.from('0123456789abcdef').toString('base64')
      const ciphertext = await aesEncrypt(unicode, key)
      assert(await aesDecrypt(ciphertext, key) == unicode, 'Async native AES encoding mismatch')
      const text = JSON.stringify({ songs: Array.from({ length: 100 }, (_, i) => ({ name: '中文歌曲🌸' + i })) })
      const msg = await encryptMsg({} as LX.Sync.KeyInfo, text)
      assert(msg.startsWith('cg_') && await decryptMsg({} as LX.Sync.KeyInfo, msg) == text, 'Compressed sync message failed')
      return { nativeMethods: methods, unicodeRoundtrip: true, compressedRoundtrip: true }
    })
    if(!offline){
      await check('sync: unpaired client asks for code and wrong code fails explicitly', async()=>{
        const context = () => ({ status: getStatus(), diagnostic: getSyncDiagnostic() })
        const missing = await expectSyncFailure(() => connectServer(address), SYNC_CODE.missingAuthCode, context)
        const wrong = await expectSyncFailure(() => connectServer(address, 'wrong-local-ci-code'), SYNC_CODE.authFailed, context)
        return { missing, wrong }
      })
      await check('sync: real native authentication, explicit mode overlay and initial compressed library transfer', async()=>{
        const songs=Array.from({length:24},(_,i)=>song('sync-local-'+i))
        await createList({id:'ci-sync-library',name:'iPad中文列表',list:songs})
        await connectServer(address,'LX-CI-84-local-only')
        await wait(()=>getStatus().status,'iOS sync handshake')
        await wait(async()=>((await api('/state')).server.userList.find((l:any)=>l.id==='ci-sync-library')?.list.length ?? 0)===24,'initial iOS library was not sent')
        return {songs:24,ready:getStatus().status}
      })
      await check('sync: independent desktop protocol peer receives initial iOS library',async()=>{
        await api('/peer/connect',{})
        const state=await api('/state')
        assert(state.ready && state.peer.userList.some((l:any)=>l.id==='ci-sync-library' && l.list.length===24),'peer did not receive iOS library')
      })
      await check('sync: live iOS add, rename and remove propagate through official server to peer',async()=>{
        await addListMusics('ci-sync-library',[song('sync-ios-new')],'bottom')
        await wait(async()=> (await api('/state')).peer.userList.find((l:any)=>l.id==='ci-sync-library')?.list.some((m:any)=>m.id==='sync-ios-new'),'peer add missing')
        const info=(await getUserLists()).find(l=>l.id==='ci-sync-library')!
        await updateUserList([{...info,name:'iOS已重命名'}])
        await removeListMusics('ci-sync-library',['sync-local-0'])
        await wait(async()=>{const l=(await api('/state')).peer.userList.find((l:any)=>l.id==='ci-sync-library');return l?.name==='iOS已重命名' && !l.list.some((m:any)=>m.id==='sync-local-0')},'peer update/remove missing')
      })
      await check('sync: peer create, compressed songs, rename and delete arrive on iOS with persisted state',async()=>{
        await api('/peer/action',{action:'list_create',data:{position:0,listInfos:[{id:'ci-peer-list',name:'PC端中文列表',locationUpdateTime:null}]}})
        await api('/peer/action',{action:'list_music_add',data:{id:'ci-peer-list',musicInfos:Array.from({length:32},(_,i)=>song('peer-'+i)),addMusicLocationType:'bottom'}})
        await wait(async()=> (await getListMusics('ci-peer-list')).length===32,'PC songs not received')
        await api('/peer/action',{action:'list_update',data:[{id:'ci-peer-list',name:'PC已重命名',locationUpdateTime:null}]})
        await api('/peer/action',{action:'list_music_remove',data:{listId:'ci-peer-list',ids:['peer-1']}})
        await wait(async()=>{const lists=await getUserLists();const songs=await getListMusics('ci-peer-list');return lists.some(l=>l.id==='ci-peer-list'&&l.name==='PC已重命名')&&songs.length===31&&!songs.some(m=>m.id==='peer-1')},'PC update missing')
        await api('/peer/action',{action:'list_create',data:{position:0,listInfos:[{id:'ci-peer-deleted',name:'PC移除测试',locationUpdateTime:null}]}})
        await wait(async()=> (await getUserLists()).some(l=>l.id==='ci-peer-deleted'),'PC create missing')
        await api('/peer/action',{action:'list_remove',data:['ci-peer-deleted']})
        await wait(async()=> !(await getUserLists()).some(l=>l.id==='ci-peer-deleted'),'PC delete did not persist')
      })
      await check('sync: abnormal connection loss reconnects without duplicating listeners',async()=>{
        const result=await api('/drop-app',{})
        assert(result.dropped>0,'fixture failed to drop actual iOS websocket')
        await wait(()=>!getStatus().status,'disconnect state not reported')
        await wait(()=>getStatus().status,'automatic reconnect failed')
        await addListMusics('ci-peer-list',[song('after-reconnect')],'bottom')
        await wait(async()=> (await api('/state')).peer.userList.find((l:any)=>l.id==='ci-peer-list')?.list.some((m:any)=>m.id==='after-reconnect'),'post-reconnect action missing')
      })
      await check('sync: disconnect cancels pending work and durable key reconnect needs no password',async()=>{
        await disconnectServer();assert(!getStatus().status,'disconnect did not update status')
        await connectServer(address)
        await wait(()=>getStatus().status,'saved-key reconnect failed')
      })
    }else{
      await check('sync: cold process recovers pairing and preserves peer edits/deletions',async()=>{
        await connectServer(address)
        await wait(()=>getStatus().status,'new process saved-key connection failed')
        const lists=await getUserLists()
        assert(lists.some(l=>l.id==='ci-peer-list'&&l.name==='PC已重命名'),'peer rename lost after restart')
        assert(!lists.some(l=>l.id==='ci-peer-deleted'),'deleted peer list resurrected')
        assert((await getListMusics('ci-peer-list')).some(m=>m.id==='after-reconnect'),'peer data lost after restart')
        await removeUserList(['ci-peer-list'])
        await wait(async()=>!(await api('/state')).peer.userList.some((l:any)=>l.id==='ci-peer-list'),'cold process removal not propagated')
      })
    }
  } finally {clearInterval(choose);removeSyncModeEvent();await disconnectServer()}
}
