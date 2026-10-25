// CI only: unmodified, pinned official sync server + an independent protocol
// client representing a desktop peer. No access to users' actual libraries.
const path = require('node:path')
const http = require('node:http')
const crypto = require('node:crypto')
const zlib = require('node:zlib')
const serverRoot = path.resolve(process.argv[2])
process.env.PORT = '18780'
process.env.BIND_IP = '127.0.0.1'
process.env.LX_USER_ci = 'LX-CI-84-local-only'
process.env.DATA_PATH = path.join(serverRoot, 'ci-data')
process.env.LOG_PATH = path.join(serverRoot, 'ci-logs')
const { WebSocket, WebSocketServer } = require(path.join(serverRoot, 'node_modules/ws'))
const { createMsg2call } = require(path.join(serverRoot, 'node_modules/message2call'))
const sockets = new Set()
const emit = WebSocketServer.prototype.emit
WebSocketServer.prototype.emit = function(event, ...args) {
  if (event === 'connection') { sockets.add(args[0]); args[0].once('close', () => sockets.delete(args[0])) }
  return emit.call(this, event, ...args)
}
const { createAudit, verifyProtocol } = require('./sync-fixture-audit.cjs')
const audit = createAudit()
const emitHttp = http.Server.prototype.emit
http.Server.prototype.emit = function(event, ...args) {
  if (event === 'request' && this.address()?.port === 18780) audit.observe(args[0], args[1])
  return emitHttp.call(this, event, ...args)
}
require(path.join(serverRoot, 'server/index.js'))
const { getUserSpace } = require(path.join(serverRoot, 'server/user/index.js'))
const base = 'http://127.0.0.1:18780'
const aes = (text, b64key) => {
  const cipher = crypto.createCipheriv('aes-128-ecb', Buffer.from(b64key, 'base64'), null)
  return Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]).toString('base64')
}
const md5 = text => crypto.createHash('md5').update(text).digest('hex')
let peer = null, rpc = null, keyInfo = null, ready = false
let lists = { defaultList: [], loveList: [], userList: [] }
const received = []
const getList = id => id === 'default' ? lists.defaultList : id === 'love' ? lists.loveList : lists.userList.find(l => l.id === id)?.list
function apply(action) {
  const d = action.data
  switch (action.action) {
    case 'list_data_overwrite': lists = d; break
    case 'list_create': for (const l of d.listInfos) if (!lists.userList.some(x => x.id === l.id)) lists.userList.splice(d.position, 0, {...l, list: []}); break
    case 'list_remove': lists.userList = lists.userList.filter(l => !d.includes(l.id)); break
    case 'list_update': for (const l of d) {const old=lists.userList.find(x=>x.id===l.id); if(old) Object.assign(old,l)} break
    case 'list_music_add': { const a=getList(d.id); if(a) for(const m of d.musicInfos) if(!a.some(x=>x.id===m.id)) d.addMusicLocationType==='top'?a.unshift(m):a.push(m); break }
    case 'list_music_remove': {const a=getList(d.listId);if(a) a.splice(0,a.length,...a.filter(m=>!d.ids.includes(m.id)));break}
    case 'list_music_overwrite': {const a=getList(d.listId);if(a)a.splice(0,a.length,...d.musicInfos);break}
    case 'list_music_clear': for(const id of d) {const a=getList(id);if(a)a.length=0} break
    case 'list_music_update': for(const update of d){const a=getList(update.id);if(a){const index=a.findIndex(m=>m.id===update.musicInfo.id);if(index>=0)a[index]=update.musicInfo}}break
    case 'list_update_position': case 'list_music_update_position': case 'list_music_move': break
    default: throw new Error('Unsupported test peer action ' + action.action)
  }
}
const wait = async(test, label, ms=15000) => {const start=Date.now();while(Date.now()-start<ms){if(await test())return;await new Promise(r=>setTimeout(r,100))}throw new Error(label)}
async function connectPeer() {
  if(ready) return
  await wait(async()=>{try{return (await fetch(base+'/hello')).ok}catch{return false}},'official server not listening')
  const pair = crypto.generateKeyPairSync('rsa', {modulusLength:2048,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}})
  const key = Buffer.from(md5(process.env.LX_USER_ci).slice(0,16)).toString('base64')
  const publicKey=pair.publicKey.replace(/-----[^-]+-----|\s/g,'')
  const response=await fetch(base+'/ah',{headers:{m:aes('lx-music auth::\n'+publicKey+'\nPC中文协议测试\nlx_music_desktop',key)}})
  if(!response.ok)throw new Error('peer authentication HTTP '+response.status)
  keyInfo=JSON.parse(crypto.privateDecrypt({key:pair.privateKey,padding:crypto.constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha1'},Buffer.from(await response.text(),'base64')).toString('utf8'))
  peer=new WebSocket('ws://127.0.0.1:18780/socket?i='+encodeURIComponent(keyInfo.clientId)+'&t='+encodeURIComponent(aes('lx-music connect',keyInfo.key)))
  rpc=createMsg2call({timeout:10000, funcsObj:{
    async getEnabledFeatures(_type,supported){return {list: supported.list===1 ? {skipSnapshot:false}:false}},
    async list_sync_get_md5(){return md5(JSON.stringify(lists))},
    async list_sync_get_sync_mode(){return 'merge_remote_local'},
    async list_sync_get_list_data(){return lists},
    async list_sync_set_list_data(data){lists=data},
    async list_sync_finished(){},
    async onListSyncAction(action){apply(action);received.push(action.action)},
    finished(){ready=true},
  }, sendMessage(data){const text=JSON.stringify(data);peer.send(text.length>1024?'cg_'+zlib.gzipSync(Buffer.from(text)).toString('base64'):text)},
  onError(error){console.error('PEER RPC',error)}})
  peer.on('message',data=>{const text=data.toString();if(text==='ping')return;rpc.message(JSON.parse(text.startsWith('cg_')?zlib.gunzipSync(Buffer.from(text.slice(3),'base64')).toString('utf8'):text))})
  peer.on('close',()=>{ready=false;rpc.destroy()})
  peer.on('error',error=>console.error('PEER SOCKET',error))
  await wait(()=>ready,'peer handshake did not finish')
}
const api = http.createServer(async(req,res)=>{
  try {
    let body='';for await(const b of req){body+=b;if(body.length>1024*1024)throw new Error('fixture request too big')}
    let result
    if(req.url==='/health')result=await verifyProtocol(base)
    else if(req.url==='/diagnostics')result={requests:audit.snapshot()}
    else if(req.url==='/peer/connect'){await connectPeer();result={ready}}
    else if(req.url==='/peer/action') {if(!ready)throw new Error('peer disconnected');const action=JSON.parse(body);apply(action);await rpc.createQueueRemote('list').onListSyncAction(action);result={ok:true}}
    else if(req.url==='/state')result={server:await getUserSpace('ci').listManage.getListData(),peer:lists,ready,received}
    else if(req.url==='/drop-app'){let dropped=0;for(const socket of sockets){if(socket.keyInfo?.clientId!==keyInfo?.clientId){socket.close(1001,'CI reconnect check');dropped++}}result={dropped}}
    else {res.writeHead(404);res.end();return}
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(result))
  }catch(error){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:String(error)}))}
})
api.listen(18781,'127.0.0.1',()=>console.log('LX official-server/desktop-protocol-peer fixture ready'))
