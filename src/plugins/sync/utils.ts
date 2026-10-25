// Wire-compatible with Android v1.9.0: UTF-8 -> Base64 -> AES/ECB/PKCS7;
// RSA responses use OAEP SHA-1, SPKI public keys and PKCS8 private keys.
// Async bridge methods work without JSI or blocking native exports.
import { aesEncrypt as nativeAESEncrypt, aesDecrypt as nativeAESDecrypt,
  rsaEncrypt as nativeRSAEncrypt, rsaDecrypt as nativeRSADecrypt, AES_MODE, RSA_PADDING } from '@/utils/nativeModules/crypto'
import { Buffer } from 'buffer'

export const aesEncrypt = async(text: string, b64Key: string): Promise<string> =>
  nativeAESEncrypt(Buffer.from(text, 'utf8').toString('base64'), b64Key, '', AES_MODE.ECB_128_NoPadding)
export const aesDecrypt = async(text: string, b64Key: string): Promise<string> =>
  nativeAESDecrypt(text, b64Key, '', AES_MODE.ECB_128_NoPadding)
export const rsaEncrypt = async(buffer: Buffer, key: string): Promise<string> =>
  nativeRSAEncrypt(buffer.toString('base64'), key, RSA_PADDING.OAEPWithSHA1AndMGF1Padding)
export const rsaDecrypt = async(buffer: Buffer, key: string): Promise<string> =>
  nativeRSADecrypt(buffer.toString('base64'), key, RSA_PADDING.OAEPWithSHA1AndMGF1Padding)
