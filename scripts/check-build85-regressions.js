// Tests the production auth code against an independent HTTP/crypto peer.
// The native bridge is deliberately async-only; actual RN bridging runs in CI.
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const crypto = require('node:crypto'), http = require('node:http'), zlib = require('node:zlib')
const ts = require('typescript')
const root = path.resolve(__dirname, '..'), read = p => fs.readFileSync(path.join(root, p), 'utf8')
const dependencies = process.argv.includes('--node-fixture-codecs') ? {
  'spark-md5': { default: { hash: s => crypto.createHash('md5').update(s, 'utf8').digest('hex') } },
  pako: { gzip: s => zlib.gzipSync(s), ungzip: s => zlib.gunzipSync(s).toString('utf8') },
} : { 'spark-md5': { default: require('spark-md5') }, pako: require('pako') }
const load = (file, mocks = {}, extra = {}) => {
  const result = ts.transpileModule(read(file), { fileName: file, reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } })
  assert.equal((result.diagnostics || []).filter(d => d.category === 1).length, 0, file)
  const exports = {}; vm.runInNewContext(result.outputText, { exports, console, Buffer, fetch, AbortController,
    setTimeout, clearTimeout, setInterval, clearInterval, ...extra, require: n => {
      if (n in mocks) return mocks[n]; if (n in dependencies) return dependencies[n]
      if (n === 'buffer') return require('buffer'); throw new Error(`Missing dependency ${n} in ${file}`)
    } }, { filename: file }); return exports
}
const plain = x => JSON.parse(JSON.stringify(x))
let checks = 0
const check = async(name, fn) => { await fn(); checks++; console.log('PASS ' + name) }
;(async() => {
  const readability = load('src/utils/readability.ts')
  const colors = load('src/utils/playingColor.ts', { './readability': readability })
  const themes = load('src/theme/themes/themes.ts').default
  const palette = item => {
    const t = { isDark: item.isDark, ...item.config.themeColors }
    for (const [k, v] of Object.entries(item.config.extInfo)) t[k] = typeof v === 'string' && v.startsWith('var(') ? t[v.slice(4, -1)] : v
    return { ...t, 'c-content-background': t['c-primary-light-1000'], 'c-primary-font': t['c-primary'], 'c-font': t['c-850'] }
  }
  await check('playing foreground follows all shipped palettes on page and popup surfaces', () => {
    const overlay = load('src/utils/overlaySurface.ts', { './readability': readability })
    const outputs = new Set()
    for (const item of themes) {
      const t = palette(item)
      for (const surface of [undefined, overlay.overlaySurface(t).backgroundColor]) {
        const c = colors.playingColor(t, surface), bg = colors.songSurface(t, surface)
        assert.ok(readability.contrastRatio(c, bg) >= 4.8, `${item.id}: ${c} / ${bg}`)
        outputs.add(c)
      }
    }
    assert.ok(outputs.size >= 8, 'Playing colour was reduced to a fixed light/dark pair')
    console.log('  ' + themes.length + ' shipped themes; ' + outputs.size + ' adapted foregrounds')
  })
  await check('custom warm, green and purple hues remain distinct with restrained saturation', () => {
    const results = []
    for (const accent of ['#d98a24', '#34a879', '#9c65bb']) for (const dark of [true, false]) {
      const t = { isDark: dark, 'c-primary': accent, 'c-font': dark ? '#ccc' : '#444', 'c-content-background': dark ? '#151515' : '#fafafa' }
      const c = colors.playingColor(t), rgb = c.match(/\d+/g).map(Number).map(v => v / 255)
      const l = (Math.max(...rgb) + Math.min(...rgb)) / 2
      const s = (Math.max(...rgb) - Math.min(...rgb)) / (1 - Math.abs(2 * l - 1))
      assert.ok(s <= .74, 'excessive HSL saturation'); assert.ok(colors.playingColorChroma(c, colors.songSurface(t)) <= .181, 'neon chroma'); assert.ok(readability.contrastRatio(c, colors.songSurface(t)) >= 4.8)
      results.push(c)
    }
    assert.equal(new Set(results).size, 6)
  })
  await check('neutral themes use a distinguishable chromatic foreground, not brighter black/white', () => {
    for (const [bg, normal] of [['#151515', '#dbdbdb'], ['#ffffff', '#444444']]) {
      const t = { isDark: bg !== '#ffffff', 'c-primary': '#888888', 'c-font': normal, 'c-content-background': bg }
      const c = colors.playingColor(t)
      assert.ok(readability.contrastRatio(c, bg) >= 4.8)
      assert.ok(colors.playingColorChroma(c, bg) >= .085)
      assert.ok(colors.playingColorDistance(c, normal, bg) >= .16)
    }
  })
  await check('alpha backgrounds and theme changes recalculate the playing foreground', () => {
    const t = { isDark: false, 'c-primary': '#bb6655', 'c-font': '#333', 'c-content-background': '#fffc' }
    const first = colors.playingColor(t)
    t.isDark = true; t['c-content-background'] = '#101010'
    const second = colors.playingColor(t); assert.notEqual(first, second)
    assert.ok(readability.contrastRatio(second, colors.songSurface(t)) >= 4.8)
  })
  await check('playing rows are not selected rows: no fill, heavy weight, or left stripe', () => {
    const row = read('src/components/common/SongRowContent.tsx')
    assert.ok(row.includes("const weight = header ? '600' : '400'"))
    for (const file of ['src/components/OnlineList/ListItem.tsx', 'src/screens/Home/Views/Mylist/MusicList/ListItem.tsx']) {
      const s = read(file)
      assert.ok(s.includes("backgroundColor: isSelected ? selection.background : 'transparent'"))
      assert.ok(s.includes('active={active} selected={isSelected}'))
      assert.ok(!s.includes('active || isSelected')); assert.ok(!s.includes('width: 3'))
    }
    const q = read('src/screens/PlayDetail/Horizontal/components/PlaylistBtn.tsx')
    assert.ok(q.includes("backgroundColor: 'transparent'")); assert.ok(!q.includes('active || focused'))
    assert.ok(q.includes('active={active} surface={surface}')); assert.ok(q.includes('name="play-outline"'))
  })
  await check('keyboard focus does not masquerade as the playing song or multi-selection', () => {
    for (const file of ['src/components/OnlineList/List.tsx', 'src/screens/Home/Views/Mylist/MusicList/List.tsx']) {
      const s = read(file); assert.ok(s.includes('focused={item.id == keyboardId}')); assert.ok(!s.includes('visualSelection'))
    }
  })
  await check('only the player queue is redirected to the left; other requested positions survive', () => {
    const panel = load('src/utils/panelLayout.ts')
    for (const position of ['top', 'bottom', 'right', 'center']) {
      assert.equal(panel.panelPosition(true, 'panel', position), position)
      assert.equal(panel.panelPosition(true, 'list', position), position)
      assert.equal(panel.panelPosition(true, 'player-playlist', position), 'left')
    }
    assert.ok(read('src/screens/PlayDetail/Horizontal/components/PlaylistBtn.tsx').includes('kind="player-playlist"'))
    assert.ok(!read('src/screens/PlayDetail/Horizontal/components/ActionBar.tsx').includes('position="left"'))
  })
  await check('keyboard preferences are in a centered bounded scrolling dialog, retaining all settings', () => {
    const s = read('src/screens/Home/Views/Setting/settings/Basic/KeyboardShortcuts.tsx')
    for (const key of ['enabled', 'playback', 'seek', 'selection', 'navigation']) assert.ok(s.includes('keyboard.' + key))
    assert.ok(s.includes('position="center"')); assert.ok(s.includes('<ScrollView')); assert.ok(s.includes('maxWidth={600}'))
    assert.ok(s.includes('dialog.current?.setVisible(true)'))
  })
  await check('previously hidden settings are present, with honest Android capability limits', () => {
    const basic = read('src/screens/Home/Views/Setting/settings/Basic/index.tsx')
    const player = read('src/screens/Home/Views/Setting/settings/Player/index.tsx')
    assert.ok(!basic.includes("Platform.OS != 'ios'")); assert.ok(!player.includes("Platform.OS != 'ios'"))
    for (const setting of ['IsShowBackBtn', 'IsShowExitBtn', 'Language', 'FontSize', 'Source', 'SourceName', 'ShareType']) assert.ok(basic.includes('<' + setting))
    for (const setting of ['IsHandleAudioFocus', 'IsEnableAudioOffload', 'MaxCache', 'PlayHighQuality']) assert.ok(player.includes('<' + setting))
  })
  const constants = load('src/plugins/sync/constants.ts'), { SYNC_CODE } = constants
  const diag = load('src/plugins/sync/diagnostics.ts', { './constants': constants })
  const aes = (text, key, encrypt) => {
    const cipher = encrypt ? crypto.createCipheriv('aes-128-ecb', Buffer.from(key, 'base64'), null) : crypto.createDecipheriv('aes-128-ecb', Buffer.from(key, 'base64'), null)
    return Buffer.concat([cipher.update(Buffer.from(text, 'base64')), cipher.final()]).toString(encrypt ? 'base64' : 'utf8')
  }
  const bridge = {
    generateRsaKey: async() => { const k = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }); return {
      publicKey: k.publicKey.export({ format: 'der', type: 'spki' }).toString('base64'), privateKey: k.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
    } },
    aesEncrypt: async(text, key, _iv, mode) => { assert.equal(mode, 'AES'); return aes(text, key, true) },
    aesDecrypt: async(text, key, _iv, mode) => { assert.equal(mode, 'AES'); return aes(text, key, false) },
    rsaDecrypt: async(text, key, mode) => { assert.equal(mode, 'RSA/ECB/OAEPWithSHA1AndMGF1Padding'); return crypto.privateDecrypt({
      key: crypto.createPrivateKey({ key: Buffer.from(key, 'base64'), format: 'der', type: 'pkcs8' }), oaepHash: 'sha1', padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
    }, Buffer.from(text, 'base64')).toString('utf8') },
  }
  const native = load('src/utils/nativeModules/crypto.ts', { 'react-native': { NativeModules: { CryptoModule: bridge } } })
  const syncCrypto = load('src/plugins/sync/utils.ts', { '@/utils/nativeModules/crypto': native })
  await check('async-only bridge completes Android-compatible AES; missing sync export no longer blocks', async() => {
    const k = Buffer.from('0123456789abcdef').toString('base64'), text = SYNC_CODE.authMsg + '\n中文iPad 🌸'
    assert.throws(() => native.aesEncryptSync('', k, '', 'AES'), /CryptoModule.aesEncryptSync is unavailable/)
    const encoded = await syncCrypto.aesEncrypt(text, k)
    assert.equal(aes(encoded, k, false), text); assert.equal(await syncCrypto.aesDecrypt(encoded, k), text)
  })
  const utils = load('src/plugins/sync/client/utils.ts', { '@/utils/nativeModules/crypto': native, '../diagnostics': diag, '../address': load('src/plugins/sync/address.ts') })
  await check('compressed v4 Unicode messages match the independent gzip/Base64 decoder', async() => {
    const text = JSON.stringify({ songs: Array.from({ length: 100 }, (_, i) => ({ name: '歌曲\n🌸' + i })) })
    const encoded = await utils.encryptMsg({}, text)
    assert.ok(encoded.startsWith('cg_')); assert.equal(zlib.gunzipSync(Buffer.from(encoded.slice(3), 'base64')).toString('utf8'), text)
    assert.equal(await utils.decryptMsg({}, encoded), text); assert.equal(await utils.encryptMsg({}, 'ping'), 'ping')
  })
  const keys = new Map(), password = 'LX中文-85', device = '测试的 iPad 🌸'
  let helloVersion = SYNC_CODE.helloMsg, pairedRequests = 0, cachedRequests = 0
  const keyInfo = { clientId: 'independent-fixture-client', key: Buffer.from('abcdef0123456789').toString('base64'), deviceName: device }
  const httpServer = http.createServer((req, res) => {
    try {
      if (req.url === '/hello') return res.end(helloVersion)
      if (req.url === '/id') return res.end(SYNC_CODE.idPrefix + 'fixture-id')
      if (req.url === '/slow') return setTimeout(() => res.end('late'), 80)
      if (req.url !== '/ah') { res.statusCode = 404; return res.end() }
      if (req.headers.i) {
        assert.equal(req.headers.i, keyInfo.clientId)
        assert.equal(aes(req.headers.m, keyInfo.key, false), SYNC_CODE.authMsg + device)
        cachedRequests++; return res.end(aes(Buffer.from(SYNC_CODE.helloMsg).toString('base64'), keyInfo.key, true))
      }
      const key = Buffer.from(crypto.createHash('md5').update(password, 'utf8').digest('hex').slice(0, 16)).toString('base64')
      const text = aes(req.headers.m, key, false).split('\n')
      assert.equal(text[0], SYNC_CODE.authMsg); assert.equal(text[2], device); assert.equal(text[3], 'lx_music_mobile')
      const publicKey = crypto.createPublicKey({ key: Buffer.from(text[1], 'base64'), type: 'spki', format: 'der' })
      pairedRequests++
      res.end(crypto.publicEncrypt({ key: publicKey, oaepHash: 'sha1', padding: crypto.constants.RSA_PKCS1_OAEP_PADDING }, Buffer.from(JSON.stringify(keyInfo))).toString('base64'))
    } catch { res.statusCode = 401; res.end(SYNC_CODE.authFailed) }
  })
  await new Promise(r => httpServer.listen(0, '127.0.0.1', r))
  const address = load('src/plugins/sync/address.ts').parseSyncAddress('http://127.0.0.1:' + httpServer.address().port)
  const auth = load('src/plugins/sync/client/auth.ts', { './utils': utils, '../data': { getSyncAuthKey: async id => keys.get(id), setSyncAuthKey: async(id, value) => keys.set(id, value) },
    '../utils': syncCrypto, '@/utils/nativeModules/utils': { getDeviceName: async() => device }, '../constants': constants, '../diagnostics': diag })
  try {
    await check('Android password-to-key byte format matches ASCII, Chinese and emoji vectors', () => {
      for (const text of ['', '123456', password, '🌸字串']) assert.equal(auth.pairingKey(text), Buffer.from(crypto.createHash('md5').update(text, 'utf8').digest('hex').slice(0, 16)).toString('base64'))
    })
    await check('unpaired server response asks for code, not an undefined-function or network error', async() => {
      await assert.rejects(auth.default(address), e => e.message === SYNC_CODE.missingAuthCode)
    })
    await check('wrong pairing code fails without saving unusable credentials', async() => {
      await assert.rejects(auth.default(address, 'wrong-code'), e => e.message === SYNC_CODE.authFailed); assert.equal(keys.size, 0)
    })
    await check('real HTTP first pairing uses SPKI, RSA-OAEP/SHA1 and stores the validated key', async() => {
      const info = await auth.default(address, password); assert.deepEqual(plain(info), keyInfo); assert.equal(pairedRequests, 1); assert.equal(keys.size, 1)
    })
    await check('saved-key reconnect preserves the exact Android cached-auth plaintext', async() => {
      const info = await auth.default(address); assert.deepEqual(plain(info), keyInfo); assert.equal(cachedRequests, 1)
    })
    await check('protocol version mismatch remains explicit instead of being swallowed', async() => {
      helloVersion = 'Hello~::^-^::~v5~'; await assert.rejects(auth.default(address), e => e.message === SYNC_CODE.highServiceVersion); helloVersion = SYNC_CODE.helloMsg
    })
    await check('HTTP timeout and explicit cancellation release their timer without native background APIs', async() => {
      await assert.rejects(utils.request('http://' + address.hostPath + '/slow', { timeout: 10 }), /请求超时/)
      const controller = new AbortController(), pending = utils.request('http://' + address.hostPath + '/slow', { signal: controller.signal })
      controller.abort(); await assert.rejects(pending, /sync_cancelled/)
    })
    await check('missing async native export is reported by stage and method, without secrets', async() => {
      const old = bridge.aesEncrypt; delete bridge.aesEncrypt
      await assert.rejects(auth.default(address), e => e.message.includes('原生 AES 已配对认证') && e.message.includes('CryptoModule.aesEncrypt'))
      bridge.aesEncrypt = old
      const message = diag.getSyncDiagnostic(); assert.ok(!message.includes(password)); assert.ok(!message.includes(keyInfo.key))
    })
  } finally { httpServer.closeAllConnections(); await new Promise(r => httpServer.close(r)) }
  await check('lockfile has one old-architecture base64 version and explicit pure-JS sync codecs', () => {
    const pkg = JSON.parse(read('package.json')), lock = JSON.parse(read('package-lock.json'))
    const versions = Object.entries(lock.packages).filter(([k]) => k.endsWith('/react-native-quick-base64')).map(([, v]) => v.version)
    assert.deepEqual(versions, ['2.2.2']); assert.equal(pkg.dependencies.buffer, '5.7.1'); assert.equal(pkg.dependencies['spark-md5'], '3.0.2')
    assert.equal(pkg.versionCode, 88)
  })
  console.log(`${checks} Build85 checks passed (${process.argv.includes('--node-fixture-codecs') ? 'Node fixture codecs; bundled packages still require CI' : 'installed production JS codec packages'}). Native bridge/official-server tests run separately.`)
})().catch(e => { console.error(e); process.exitCode = 1 })
