import { Buffer } from 'buffer'
import SparkMD5 from 'spark-md5'
import { request, generateRsaKey } from './utils'
import { getSyncAuthKey, setSyncAuthKey } from '../data'
import { aesDecrypt, aesEncrypt, rsaDecrypt } from '../utils'
import { getDeviceName } from '@/utils/nativeModules/utils'
import { SYNC_CODE } from '../constants'
import { atSyncStage, assertSyncActive } from '../diagnostics'

// Exact Android key derivation: first 16 ASCII hex characters of MD5(password),
// NOT the first 16 digest bytes. MD5 is required by the existing v4 protocol.
export const pairingKey = (code: string) => Buffer.from(SparkMD5.hash(code).slice(0, 16), 'utf8').toString('base64')
const baseURL = (url: LX.Sync.UrlInfo) => `${url.httpProtocol}//${url.hostPath}`
const validateKey = (info: LX.Sync.KeyInfo) => {
  if (!info || typeof info.clientId != 'string' || !info.clientId || typeof info.key != 'string' || Buffer.from(info.key, 'base64').length != 16) {
    throw new Error(SYNC_CODE.authFailed)
  }
  return info
}
const hello = async(url: LX.Sync.UrlInfo, signal?: AbortSignal) => atSyncStage('服务协议检查 /hello', async() => {
  const { text, code } = await request(baseURL(url) + '/hello', { signal })
  if (code != 200) throw new Error(`HTTP ${code}`)
  if (text == SYNC_CODE.helloMsg) return
  if (text.startsWith('Hello~::^-^::')) {
    const remote = /v(\d+)/.exec(text)?.[1]
    const local = /v(\d+)/.exec(SYNC_CODE.helloMsg)?.[1]
    if (remote && local && +remote > +local) throw new Error(SYNC_CODE.highServiceVersion)
    if (remote && local && +remote < +local) throw new Error(SYNC_CODE.lowServiceVersion)
  }
  throw new Error('服务器没有返回 LX v4 同步协议，请核对地址和端口')
})
const codeAuth = async(url: LX.Sync.UrlInfo, serverId: string, authCode: string, signal?: AbortSignal) => {
  const key = await atSyncStage('配对码摘要', () => pairingKey(authCode))
  const keys = await atSyncStage('原生 RSA 密钥生成', generateRsaKey)
  assertSyncActive(signal)
  const publicKey = keys.publicKey.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s/g, '')
  const name = await atSyncStage('读取设备名称', getDeviceName)
  const msg = await atSyncStage('原生 AES 配对请求加密', () => aesEncrypt(`${SYNC_CODE.authMsg}\n${publicKey}\n${name}\nlx_music_mobile`, key))
  assertSyncActive(signal)
  const { text, code } = await atSyncStage('首次配对 /ah', () => request(baseURL(url) + '/ah', { headers: { m: msg }, signal }))
  if (text == SYNC_CODE.msgBlockedIp) throw new Error(SYNC_CODE.msgBlockedIp)
  if (text == SYNC_CODE.authFailed || code != 200) throw new Error(SYNC_CODE.authFailed)
  const decoded = await atSyncStage('原生 RSA 配对响应解密', () => rsaDecrypt(Buffer.from(text, 'base64'), keys.privateKey))
  const info = await atSyncStage('验证配对响应', () => validateKey(JSON.parse(decoded) as LX.Sync.KeyInfo))
  assertSyncActive(signal)
  await atSyncStage('保存配对信息', () => setSyncAuthKey(serverId, info))
  return info
}
const keyAuth = async(url: LX.Sync.UrlInfo, info: LX.Sync.KeyInfo, signal?: AbortSignal) => {
  validateKey(info)
  const name = await atSyncStage('读取设备名称', getDeviceName)
  // Android cached-key auth deliberately has no newline between prefix and name.
  const msg = await atSyncStage('原生 AES 已配对认证', () => aesEncrypt(SYNC_CODE.authMsg + name, info.key))
  assertSyncActive(signal)
  const { text, code } = await atSyncStage('已配对认证 /ah', () => request(baseURL(url) + '/ah', { headers: { i: info.clientId, m: msg }, signal }))
  if (text == SYNC_CODE.msgBlockedIp) throw new Error(SYNC_CODE.msgBlockedIp)
  if (code != 200 || text == SYNC_CODE.authFailed) throw new Error(SYNC_CODE.authFailed)
  const decoded = await atSyncStage('原生 AES 认证响应解密', () => aesDecrypt(text, info.key))
  if (decoded != SYNC_CODE.helloMsg) throw new Error(SYNC_CODE.authFailed)
}
export default async(url: LX.Sync.UrlInfo, authCode?: string, signal?: AbortSignal) => {
  await hello(url, signal)
  const serverId = await atSyncStage('读取服务标识 /id', async() => {
    const { text, code } = await request(baseURL(url) + '/id', { signal })
    if (code != 200 || !text.startsWith(SYNC_CODE.idPrefix)) throw new Error(SYNC_CODE.getServiceIdFailed)
    return text.slice(SYNC_CODE.idPrefix.length)
  })
  if (!serverId) throw new Error(SYNC_CODE.getServiceIdFailed)
  assertSyncActive(signal)
  if (authCode) return codeAuth(url, serverId, authCode, signal)
  const info = await atSyncStage('读取已有配对', () => getSyncAuthKey(serverId))
  if (!info) throw new Error(SYNC_CODE.missingAuthCode)
  await keyAuth(url, info, signal)
  return info
}
