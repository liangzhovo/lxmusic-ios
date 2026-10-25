import { SYNC_CLOSE_CODE } from '@/plugins/sync/constants'
import { registerDislikeActionEvent } from '../../../dislikeEvent'

const subscriptions = new WeakMap<LX.Sync.Socket, () => void>()
export const registerEvent = (socket: LX.Sync.Socket) => {
  unregisterEvent(socket)
  subscriptions.set(socket, registerDislikeActionEvent(action => {
    if (socket.readyState != 1 || !socket.moduleReadys.dislike) return
    void socket.remoteQueueDislike.onDislikeSyncAction(action).catch(error => {
      socket.moduleReadys.dislike = false
      socket.close(SYNC_CLOSE_CODE.failed)
      console.warn('Synchronization action failed', String(error))
    })
  }))
}
export const unregisterEvent = (socket: LX.Sync.Socket) => {
  subscriptions.get(socket)?.()
  subscriptions.delete(socket)
}
