import { SYNC_CLOSE_CODE } from '@/plugins/sync/constants'
import { registerListActionEvent } from '../../../listEvent'

const subscriptions = new WeakMap<LX.Sync.Socket, () => void>()
export const registerEvent = (socket: LX.Sync.Socket) => {
  unregisterEvent(socket)
  subscriptions.set(socket, registerListActionEvent(action => {
    if (socket.readyState != 1 || !socket.moduleReadys.list) return
    void socket.remoteQueueList.onListSyncAction(action).catch(error => {
      socket.moduleReadys.list = false
      socket.close(SYNC_CLOSE_CODE.failed)
      console.warn('Synchronization action failed', String(error))
    })
  }))
}
export const unregisterEvent = (socket: LX.Sync.Socket) => {
  subscriptions.get(socket)?.()
  subscriptions.delete(socket)
}
