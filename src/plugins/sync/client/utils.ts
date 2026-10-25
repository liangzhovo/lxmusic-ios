import { Buffer } from 'buffer'
import { gzip, ungzip } from 'pako'
import { assertSyncActive, syncCancelled } from '../diagnostics'

// Auth requests use RN's standard timer/AbortController; no optional background
// timer native method or file-system compression method is needed to connect.
export const request = async(url: string, { timeout = 10000, signal, ...options }: RequestInit & { timeout?: number } = {}) => {
  assertSyncActive(signal ?? undefined)
  const controller = new AbortController()
  let expired = false
  const cancel = () => controller.abort()
  signal?.addEventListener('abort', cancel)
  const timer = setTimeout(() => { expired = true; controller.abort() }, timeout)
  try {
    const response = await fetch(url, { ...options, signal: controller.signal })
    const text = await response.text()
    assertSyncActive(signal ?? undefined)
    return { text, code: response.status }
  } catch (error) {
    if (signal?.aborted) throw syncCancelled()
    if (expired) throw new Error('请求超时，请检查同步服务与本地网络权限')
    throw error
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel) }
}
export { generateRsaKey } from '@/utils/nativeModules/crypto'
// v4's cg_ is gzip + standard Base64, not AES. Preserve the Android wire format.
export const encryptMsg = async(_keyInfo: LX.Sync.KeyInfo, msg: string): Promise<string> =>
  msg.length > 1024 ? 'cg_' + Buffer.from(gzip(msg)).toString('base64') : msg
export const decryptMsg = async(_keyInfo: LX.Sync.KeyInfo, msg: string): Promise<string> =>
  msg.startsWith('cg_') ? ungzip(Buffer.from(msg.slice(3), 'base64'), { to: 'string' }) : msg
export { parseSyncAddress as parseUrl } from '../address'
export const sendStatus = (_status: LX.Sync.Status) => {}
