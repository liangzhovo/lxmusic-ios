import { NativeEventEmitter, NativeModules, Platform } from 'react-native'
import type { TransferProgress } from './types'
interface LibraryModule {
  command: (action: string, payload: Record<string, unknown>) => Promise<any>
  cancel: (id: string) => void
  addListener: (name: string) => void
  removeListeners: (count: number) => void
}
const module = NativeModules.LXLibraryServices as LibraryModule | undefined
let sequence = 0
export const operationId = () => `lx-${Date.now().toString(36)}-${(++sequence).toString(36)}-${Math.random().toString(36).slice(2, 12)}`
export const available = () => Platform.OS === 'ios' && !!module
export function nativeCommand<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  if (!available()) return Promise.reject(new Error('该资料库功能需要本项目的iOS原生构建'))
  return module!.command(action, payload) as Promise<T>
}
export const cancelOperation = (id: string) => { module?.cancel(id) }
export function observeProgress(handler: (event: TransferProgress) => void) {
  if (!module || !available()) return () => {}
  const event = new NativeEventEmitter(module).addListener('LXLibraryProgress', handler)
  return () => { event.remove() }
}
