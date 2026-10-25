import handleAuth from './auth'
import { connect as socketConnect, disconnect as socketDisconnect, sendSyncStatus } from './client'
import { parseUrl } from './utils'
import { SYNC_CODE } from '../constants'
import { removeSyncModeEvent } from '@/core/sync'
import { atSyncStage, resetSyncDiagnostic } from '../diagnostics'

let connectId = 0
let authController: AbortController | null = null
export const connectServer = async(host: string, authCode?: string) => {
  const id = ++connectId
  authController?.abort()
  const controller = new AbortController()
  authController = controller
  resetSyncDiagnostic()
  try {
    removeSyncModeEvent()
    await socketDisconnect()
    if (id != connectId) return
    sendSyncStatus({ status: false, message: SYNC_CODE.connecting })
    const url = parseUrl(host)
    const key = await handleAuth(url, authCode?.trim(), controller.signal)
    if (id != connectId) return
    await atSyncStage('WebSocket 握手初始化', () => socketConnect(url, key))
  } catch (error: any) {
    if (id != connectId || controller.signal.aborted) return
    sendSyncStatus({ status: false, message: error?.message || SYNC_CODE.connectServiceFailed })
    throw error
  } finally { if (authController === controller) authController = null }
}
export const disconnectServer = async(isResetStatus = true) => {
  ++connectId
  authController?.abort(); authController = null
  removeSyncModeEvent()
  await socketDisconnect()
  if (isResetStatus) sendSyncStatus({ status: false, message: '' })
}
export { getStatus, hasClientConnection } from './client'
