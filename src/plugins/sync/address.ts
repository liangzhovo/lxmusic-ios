// Avoid relying on RN's incomplete URL polyfill. Keep proxy path, not credentials.
export const normalizeSyncAddress = (value: string): string => {
  let address = value.trim()
  if (!address) throw new Error('请输入电脑端显示的同步地址')
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(address)) address = 'http://' + address
  const match = /^(https?):\/\/((?:\[[0-9a-f:.]+\]|[a-z0-9._-]+)(?::([0-9]+))?)(\/[^\s?#]*)?\/*$/i.exec(address)
  if (!match) throw new Error('同步地址无效，请使用 http://主机:端口 或 https://主机/路径')
  if (match[3] && (Number(match[3]) < 1 || Number(match[3]) > 65535)) throw new Error('同步端口须为 1–65535')
  return `${match[1].toLowerCase()}://${match[2]}${(match[4] || '').replace(/\/+$/, '')}`
}
export const parseSyncAddress = (value: string) => {
  const href = normalizeSyncAddress(value)
  const httpProtocol = href.startsWith('https:') ? 'https:' : 'http:'
  return { href, httpProtocol, wsProtocol: httpProtocol == 'https:' ? 'wss:' : 'ws:', hostPath: href.slice(httpProtocol.length + 2) }
}
