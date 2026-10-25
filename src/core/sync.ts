import { dismissOverlay, onModalDismissed, showSyncModeModal } from '@/navigation'
import syncState from '@/store/sync/state'
import syncActions from '@/store/sync/action'
import { keyboardRouter } from '@/core/keyboardRouter'

let cancelPending: (() => void) | null = null
let serial = 0
export const setSyncStatus = (status: LX.Sync.Status) => syncActions.setStatus(status)
export const setSyncMessage = (message: string) => syncActions.setMessage(message)
export const setSyncModeComponentId = (id: string) => syncActions.setSyncModeComponentId(id)
export const removeSyncModeEvent = () => { cancelPending?.() }
export const selectSyncMode = async<T extends keyof LX.Sync.ModeTypes>(serverName: string, type: T) => new Promise<LX.Sync.ModeTypes[T]>((resolve, reject) => {
  removeSyncModeEvent()
  const id = `lx-sync-mode-${++serial}`
  // Native RNN overlays are not React Native Modal roots. Reserve an isolated
  // keyboard layer here so arrows/Enter cannot activate the underlying song list.
  const layer = -serial
  keyboardRouter.openLayer(layer)
  let removeKeyboard: (() => void) | null = null
  let settled = false
  let removeDismiss: (() => void) | null = null
  const close = () => { void dismissOverlay(id).catch(() => {}) }
  const clean = () => {
    removeKeyboard?.(); removeKeyboard = null
    keyboardRouter.closeLayer(layer)
    removeDismiss?.(); removeDismiss = null
    global.app_event.off('selectSyncMode', select)
    if (syncState.syncModeComponentId == id) syncActions.setSyncModeComponentId('')
    if (cancelPending === cancel) cancelPending = null
  }
  const cancel = () => {
    if (settled) return
    settled = true; clean(); close(); reject(new Error('cancel'))
  }
  const select = (result: LX.Sync.ModeType) => {
    if (settled || result.type != type) return
    settled = true; clean(); close(); resolve(result.mode as LX.Sync.ModeTypes[T])
  }
  removeKeyboard = keyboardRouter.register({ layer, enabled: () => true, handle: action => {
    if (action != 'escape') return false
    cancel(); return true
  } })
  cancelPending = cancel
  syncActions.setServerInfo(serverName, type)
  syncActions.setSyncModeComponentId(id)
  global.app_event.on('selectSyncMode', select)
  removeDismiss = onModalDismissed(id, cancel)
  void showSyncModeModal(id).then(() => { if (settled) close() }).catch(error => {
    if (settled) return
    settled = true; clean(); reject(error)
  })
})

export const cancelSyncModeForId = (id: string) => { if (syncState.syncModeComponentId == id) removeSyncModeEvent() }
