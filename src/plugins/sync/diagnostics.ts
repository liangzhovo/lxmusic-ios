// Never persist credentials, headers, private keys, or full server URLs.
import { SYNC_CODE } from './constants'
let diagnostic = ''
const protocolMessages = new Set<string>(Object.values(SYNC_CODE))
export const resetSyncDiagnostic = () => { diagnostic = '' }
export const getSyncDiagnostic = () => diagnostic
export const syncCancelled = () => new Error('sync_cancelled')
export const assertSyncActive = (signal?: AbortSignal) => { if (signal?.aborted) throw syncCancelled() }
export const atSyncStage = async<T>(stage: string, action: () => T | Promise<T>): Promise<T> => {
  try { return await action() } catch (error: any) {
    const message = String(error?.message || error || '未知错误')
    if (message == 'sync_cancelled' || protocolMessages.has(message)) throw error
    if (error?.syncStage) throw error
    const safe = message.replace(/https?:\/\/\S+/gi, '[服务器地址]')
      .replace(/(password|authCode|privateKey|authorization|token)[=:]\s*\S+/gi, '$1=[已隐藏]').slice(0, 280)
    diagnostic = `同步阶段：${stage}；${error?.name || 'Error'}：${safe}`
    const failure = new Error(diagnostic) as Error & { syncStage: string }
    failure.syncStage = stage
    throw failure
  }
}
