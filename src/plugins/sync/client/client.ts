import { encryptMsg, decryptMsg } from './utils'
import { callObj } from './sync'
import log from '../log'
import { aesEncrypt } from '../utils'
import { setSyncStatus, removeSyncModeEvent } from '@/core/sync'
import { createMsg2call } from 'message2call'
import { SYNC_CLOSE_CODE, SYNC_CODE } from '../constants'
import { atSyncStage } from '../diagnostics'

let status: LX.Sync.Status = { status: false, message: '' }
export const sendSyncStatus = (value: LX.Sync.Status) => { status = { ...value }; setSyncStatus(status) }
export const sendSyncMessage = (message: string) => sendSyncStatus({ ...status, message })
let client: LX.Sync.Socket | null = null
let retry: ReturnType<typeof setTimeout> | null = null
let retryCount = 0
let connectionGeneration = 0
let disposeCurrent: (() => void) | null = null
const clearRetry = () => { if (retry) clearTimeout(retry); retry = null }

export const connect = async(urlInfo: LX.Sync.UrlInfo, keyInfo: LX.Sync.KeyInfo) => {
  const generation = ++connectionGeneration
  clearRetry()
  disposeCurrent?.()
  client = null
  const token = await atSyncStage('原生 AES WebSocket 凭据', () => aesEncrypt(SYNC_CODE.msgConnect, keyInfo.key))
  if (generation != connectionGeneration) return
  if (typeof createMsg2call != 'function') throw new Error('message2call v0.1.3 API is unavailable')
  const socket = new WebSocket(`${urlInfo.wsProtocol}//${urlInfo.hostPath}/socket?i=${encodeURIComponent(keyInfo.clientId)}&t=${encodeURIComponent(token)}`) as LX.Sync.Socket
  client = socket
  socket.data = { keyInfo, urlInfo }
  socket.isReady = false
  socket.moduleReadys = { list: false, dislike: false }
  const current = () => client === socket && !disposed
  let disposed = false
  let closeEvents: Array<(err: Error) => void | Promise<void>> = []
  let heartbeat: ReturnType<typeof setTimeout> | null = null
  let timeout: ReturnType<typeof setTimeout> | null = null
  let sending = Promise.resolve()
  let receiving = Promise.resolve()
  const clearTimers = () => {
    if (heartbeat) clearTimeout(heartbeat)
    if (timeout) clearTimeout(timeout)
    heartbeat = timeout = null
  }
  const beat = () => {
    if (heartbeat) clearTimeout(heartbeat)
    heartbeat = setTimeout(() => { if (current()) socket.close(4000, 'heartbeat timeout') }, 45000)
  }
  const protocolError = (error: unknown) => {
    if (!current()) return
    sendSyncStatus({ status: false, message: '同步消息处理失败，请重新连接' })
    log.error('sync message failure', error)
    socket.close(SYNC_CLOSE_CODE.failed)
  }
  const rpc = createMsg2call<LX.Sync.ServerSyncActions>({
    funcsObj: { ...callObj, finished() {
      if (!current()) return
      socket.isReady = true
      retryCount = 0
      sendSyncStatus({ status: true, message: '' })
    } },
    timeout: 120000,
    sendMessage(data) {
      if (!current() || socket.readyState != 1) throw new Error('disconnected')
      // Compression is async. Serialize encoding and transmission together.
      sending = sending.then(async() => {
        const encoded = await atSyncStage('同步消息压缩', () => encryptMsg(keyInfo, JSON.stringify(data)))
        if (current() && socket.readyState == 1) socket.send(encoded)
      }).catch(protocolError)
    },
    onCallBeforeParams(rawArgs) { if (!current()) throw new Error('disconnected'); return [socket, ...rawArgs] },
    onError(error, path, groupName) {
      if (current()) log.r_error(`sync ${groupName ?? ''} ${path.join('.')} failed`, error)
    },
  })
  socket.remote = rpc.remote
  socket.remoteQueueList = rpc.createQueueRemote('list')
  socket.remoteQueueDislike = rpc.createQueueRemote('dislike')
  socket.onClose = handler => {
    closeEvents.push(handler)
    return () => { const index = closeEvents.indexOf(handler); if (index >= 0) closeEvents.splice(index, 1) }
  }
  const dispose = () => {
    if (disposed) return
    disposed = true
    clearTimers()
    rpc.destroy()
    for (const handler of closeEvents.splice(0)) {
      try { void Promise.resolve(handler(new Error('closed'))).catch(() => {}) } catch { /* Other close handlers still run. */ }
    }
    if (socket.readyState < 2) socket.close(SYNC_CLOSE_CODE.normal)
  }
  disposeCurrent = dispose
  timeout = setTimeout(() => { if (current()) socket.close(4000, 'connection timeout') }, 15000)
  socket.addEventListener('open', () => {
    if (!current()) return
    if (timeout) clearTimeout(timeout)
    timeout = null
    beat()
    sendSyncStatus({ status: false, message: '连接成功，等待选择同步方向…' })
  })
  socket.addEventListener('message', ({ data }) => {
    if (!current()) return
    if (data == 'ping') { beat(); return }
    if (typeof data != 'string') { protocolError(new Error('non-text sync message')); return }
    receiving = receiving.then(async() => {
      const decoded = await atSyncStage('同步消息解压', () => decryptMsg(keyInfo, data))
      if (current()) rpc.message(JSON.parse(decoded))
    }).catch(protocolError)
  })
  socket.addEventListener('error', () => {
    if (current()) sendSyncStatus({ status: false, message: '连接失败，请检查电脑同步服务、防火墙及本地网络权限' })
  })
  socket.addEventListener('close', ({ code }) => {
    if (!current()) return
    dispose()
    removeSyncModeEvent()
    if (code == SYNC_CLOSE_CODE.normal || code == SYNC_CLOSE_CODE.failed) {
      client = null
      sendSyncStatus({ status: false, message: code == SYNC_CLOSE_CODE.normal ? '' : status.message || '同步失败，请重新连接' })
      return
    }
    sendSyncStatus({ status: false, message: '连接中断，正在重连…' })
    retry = setTimeout(() => {
      retry = null
      if (client === socket) void connect(urlInfo, keyInfo).catch((error: Error) => sendSyncStatus({ status: false, message: error.message }))
    }, Math.min(2000 * ++retryCount, 30000))
  })
}
export const disconnect = async() => {
  ++connectionGeneration
  clearRetry()
  // Invalidate before close: an old close/message callback must not touch a new connection.
  client = null
  disposeCurrent?.()
  disposeCurrent = null
  retryCount = 0
}
export const hasClientConnection = () => client != null && (client.readyState == 0 || client.readyState == 1)
export const getStatus = () => ({ ...status })
