// Simulator-only driver routed through LXPlaybackTestSupport. Every operation
// below uses the real App library facade/native bridge/player; only media and
// the loopback DAV account are synthetic. No user service is contacted.
import React from 'react'
import { NativeModules, View, Text } from 'react-native'
import { Navigation } from 'react-native-navigation'
import RNFS from 'react-native-fs'
import { onAppLaunched } from '@/navigation/regLaunchedEvent'
import { createI18n } from '@/lang'
import { Provider } from '@/store/Provider'
import { applyTheme } from '@/core/theme'
import { applyNavigationAppearance, navigationAppearance } from '@/navigation/appearance'
import themes from '@/theme/themes/themes'
import { windowSizeTools } from '@/utils/windowSizeTools'
import { initial } from '@/plugins/player'
import { initUnifiedPlayerEngine } from '@/plugins/player/engine'
import { getPosition, setStop } from '@/plugins/player/utils'
import { loadPlaybackResource } from '@/plugins/player/engine/resourceLoader'
import { getMusicUrlInfo } from '@/core/music'
import { getListMusics, getUserLists, setUserList, overwriteListMusics, createList } from '@/core/list'
import { saveData, getData } from '@/plugins/storage'
import { initSetting, updateSetting } from '@/core/common'
import playerActions from '@/store/player/action'
import { initializeLibrary, saveAccount, browseDirectory, importEntries, downloadQueue, prepareLibraryPlayback,
  releaseLibraryPlayback, refreshConfig, createEncryptedBackup, stageEncryptedRestore, armRestore, restoreStatus,
  acknowledgeRestore, uploadBackup, fetchBackup, localDownloadPath, addPublished } from '@/core/library'
import type { BackupFile, DirectoryEntry, DownloadJob, LibraryAccount } from '@/core/library/types'
import { entryMusic, getLibraryReference } from '@/core/library/reference'
import Library from '@/screens/Home/Views/Library'
import PlayerCover from '@/components/player/PlayerCover'
import settingState from '@/store/setting/state'

const support = NativeModules.LXPlaybackTestSupport
const phase: string = support.libraryPhase
const host = 'http://127.0.0.1:18782'
// This is a fixture credential, never a user's password. No credentials in reports.
const accountInput = { id: 'ci-library-dav', name: 'WebDAV 集成验证', endpoint: host + '/dav/', username: 'lx-ci', password: 'synthetic-local-password', allowHTTP: true, directoryCache: true, audioCache: true }
const password = 'synthetic-backup-passphrase-88'
const home = RNFS.DocumentDirectoryPath.replace(/\/Documents$/, '')
const externalState = home + '/Library/LXBackupExports/library-smoke-state.json'
const marker = RNFS.DocumentDirectoryPath + '/library-persistent-marker.txt'
const storageKey = '@ci_complete_backup_payload'
const sleep = async(ms: number) => new Promise(resolve => setTimeout(resolve, ms))
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
const bounded = async<T,>(promise: Promise<T>, label: string, ms: number) => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try { return await Promise.race([promise, new Promise<never>((resolve, reject) => { timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms}ms`)), ms) })]) }
  finally { if (timer) clearTimeout(timer) }
}
const until = async(work: () => Promise<boolean> | boolean, label: string, ms = 15000) => {
  const start = Date.now()
  while (Date.now() - start < ms) { if (await work()) return; await sleep(120) }
  throw new Error(label)
}
const control = async(path: string, method = 'GET') => {
  const response = await fetch(host + '/control/' + path, { method })
  if (!response.ok) throw new Error('Fixture control unavailable')
  return method === 'GET' ? response.json() : null
}
const trace = () => control('trace') as Promise<Array<{ method: string, path: string, status: number, validatedRange?: boolean }>>
const clearTrace = () => control('clear', 'POST')
const saved = async() => JSON.parse(await RNFS.readFile(externalState, 'utf8')) as { playlist: string, entries: DirectoryEntry[], full?: BackupFile, playlistBackup?: BackupFile }
const writeState = async(value: Awaited<ReturnType<typeof saved>>) => RNFS.writeFile(externalState, JSON.stringify(value), 'utf8')

export const run = async() => {
  const checks: Array<{ name: string, ok: boolean, detail: unknown }> = []
  let stage = 'launch'
  let substage = ''
  const record = (done = false, error?: unknown) => support.record({ phase: `library-${phase}`, done, success: done && !error, stage, substage, checks,
    error: error ? String(error) : undefined, boundary: 'actual simulator App + synthetic loopback DAV; not physical-device acceptance' })
  const at = async(name: string) => { substage = name; await record() }
  const check = async(name: string, task: () => Promise<unknown>, ms = 45000) => {
    stage = name; substage = ''; await record()
    const detail = await bounded(task(), name, ms)
    checks.push({ name, ok: true, detail: detail ?? null }); await record()
  }
  const playback = async(info: LX.Music.MusicInfo, quality: LX.Quality = '128k') => {
    const resolved = await getMusicUrlInfo({ musicInfo: info, quality, allowToggleSource: false, cacheAudio: false })
    assert(resolved.url.startsWith('lx-library://'), 'Real music resolver did not use protected library reference')
    await loadPlaybackResource({ musicInfo: info, url: resolved.url, time: 0, quality })
    const before = await bounded(getPosition(), 'native getPosition', 3000)
    await until(async() => (await bounded(getPosition(), 'native getPosition', 3000)) > before + .25, 'Real native playback did not advance', 14000)
    const after = await bounded(getPosition(), 'native getPosition', 3000)
    await setStop(); return { before, after, source: 'production music resolver/resource loader/native player' }
  }
  const waitJob = async(id: string) => {
    await until(() => { const job = downloadQueue.snapshot().jobs.find(j => j.id === id); if (job?.status === 'failed') throw new Error('Native download failed: ' + job.error); return job?.status === 'completed' }, 'Download did not complete', 60000)
    const job = downloadQueue.snapshot().jobs.find(j => j.id === id)!
    assert(job.result && /^[0-9a-f]{64}$/.test(job.result.sha256), 'Completed download has no verified receipt')
    return job
  }
  try {
    await new Promise<void>(resolve => onAppLaunched(resolve))
    global.i18n = createI18n('zh_cn'); await windowSizeTools.init(); await initSetting()
    applyTheme(JSON.parse(JSON.stringify(themes.find(t => !t.isDark)!)))
    applyNavigationAppearance(false)
    setUserList(await getUserLists())
    await initializeLibrary()
    initUnifiedPlayerEngine()
    await initial({ volume: .4, playRate: 1, cacheSize: 32, isHandleAudioFocus: true, isEnableAudioOffload: false })
    await RNFS.mkdir(home + '/Library/LXBackupExports')
    const cover = phase === 'cover-cd' || phase === 'cover-square'
    if (cover) {
      updateSetting({ 'playDetail.coverStyle': phase === 'cover-cd' ? 'cd' : 'square' })
      playerActions.setIsPlay(false)
    }
    const visualTab = phase === 'ui-downloads' ? 'downloads' : phase === 'ui-backup' ? 'backup' : 'webdav'
    Navigation.registerComponent('LXLibrarySmoke', () => () => <Provider><View style={{ flex: 1 }}>
      {cover ? <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><PlayerCover componentId="LXLibrarySmoke" size={320} url={require('../../doc/images/icon.png')} active /></View>
        : phase.startsWith('ui-') ? <Library initialTab={visualTab} /> : <Text>Build88 · 原生资料库集成检查</Text>}
    </View></Provider>)
    await Navigation.setRoot({ root: { component: { id: 'LXLibrarySmoke', name: 'LXLibrarySmoke', options: { ...navigationAppearance(false), layout: { orientation: ['portrait'] } } } } })
    // Let normal UI/account/readiness settle; the backup snapshot then forbids writes.
    await sleep(1400)
    if (cover || phase.startsWith('ui-')) {
      await check('production view mounted inside real native scene', async() => {
        const scene = await support.windowSnapshot(); assert(scene.sceneAttached, 'No native scene')
        assert(!cover || settingState.setting['playDetail.coverStyle'] === (phase === 'cover-cd' ? 'cd' : 'square'), 'Cover preference mismatch')
        return { sceneAttached: scene.sceneAttached, component: cover ? 'PlayerCover' : 'Library', variant: cover ? settingState.setting['playDetail.coverStyle'] : visualTab }
      })
      await record(true); return
    }
    if (phase === 'online') {
      let entries: DirectoryEntry[] = [], playlist = ''
      await check('download feature is disabled on real first launch', async() => {
        assert(downloadQueue.snapshot().enabled === false && !global.lx.libraryDownloadsEnabled, 'Download enabled by default')
        let rejected = false
        try { await downloadQueue.enqueue([entryMusic(accountInput.id, { path: 'audio/tone.mp3', name: 'tone.mp3', directory: false })]) } catch { rejected = true }
        assert(rejected && downloadQueue.snapshot().jobs.length === 0, 'Disabled queue accepted a job')
        return { enabled: false, nativeJobs: 0 }
      })
      await check('real Keychain account CRUD and directory-cache controls', async() => {
        const config = await saveAccount(accountInput)
        assert(config.accounts[0].passwordSaved && !('password' in config.accounts[0]), 'Credential leaked or not saved')
        await clearTrace(); entries = await browseDirectory(accountInput.id, 'audio', true).promise
        assert(entries.some(e => e.name === 'tone.mp3') && entries.some(e => e.name === 'tone.flac') && entries.some(e => e.name.includes('蓝')), 'DAV XML/Unicode entry missing')
        const before = (await trace()).filter(e => e.method === 'PROPFIND').length
        await browseDirectory(accountInput.id, 'audio').promise
        assert((await trace()).filter(e => e.method === 'PROPFIND').length === before, 'Directory cache still contacted server')
        await saveAccount({ ...config.accounts[0], directoryCache: false })
        await browseDirectory(accountInput.id, 'audio').promise; await browseDirectory(accountInput.id, 'audio').promise
        assert((await trace()).filter(e => e.method === 'PROPFIND').length === before + 2, 'Disabled directory cache did not fetch twice')
        await saveAccount({ ...config.accounts[0], directoryCache: true })
        return { entries: entries.length, noCredentialsInPublicConfig: true }
      })
      await check('DAV entries import into real persistent My Lists with opaque references', async() => {
        const target = 'ci-mylist-webdav'
        await createList({ id: target, name: 'WebDAV 自动验收' })
        const result = await importEntries(accountInput.id, entries.filter(e => ['tone.mp3', 'tone.flac'].includes(e.name)), target)
        playlist = result.id
        const songs = await getListMusics(playlist)
        assert(songs.length === 2 && songs.every(s => getLibraryReference(s)?.kind === 'webdav'), 'Actual saved music refs missing')
        assert(!JSON.stringify(songs).includes(accountInput.password) && !JSON.stringify(songs).includes('Authorization'), 'Songs persisted credentials')
        await writeState({ playlist, entries }); return { count: songs.length }
      })
      for (const [format, quality] of [['mp3', '128k'], ['flac', 'flac']] as const) {
        await check(`${format} actual protected playback and verified cache avoid second GET`, async() => {
          const info = (await getListMusics(playlist)).find(s => s.source === 'local' && s.meta.ext === format)!
          await clearTrace(); const first = await playback(info, quality)
          const count = (await trace()).filter(e => e.method === 'GET' && e.path === `audio/tone.${format}`).length
          assert(count === 1, 'Cold library playback must download exactly once')
          const second = await playback(info, quality)
          assert((await trace()).filter(e => e.method === 'GET' && e.path === `audio/tone.${format}`).length === count, 'Cached playback fetched network again')
          return { first, second, GETs: count }
        })
      }
      await check('independent audio cache OFF causes each preparation to fetch while directory cache remains ON', async() => {
        const a = (await refreshConfig()).accounts[0]
        await saveAccount({ ...a, audioCache: false })
        const song = (await getListMusics(playlist))[0], ref = getLibraryReference(song)!
        await clearTrace()
        for (let i = 0; i < 2; i++) { const resource = await prepareLibraryPlayback(ref).promise; assert(!resource.cached, 'Disabled audio cache returned cached file'); await releaseLibraryPlayback(resource.lease) }
        assert((await trace()).filter(e => e.method === 'GET' && e.path === ref.path).length === 2, 'Audio OFF incorrectly reused cache')
        assert((await refreshConfig()).accounts[0].directoryCache, 'Audio toggle modified directory setting')
        await saveAccount({ ...a, audioCache: true }); return { separateSwitches: true, GETs: 2 }
      })
      await check('real native queue pause then strong-ETag verified resume publishes local file', async() => {
        await downloadQueue.setEnabled(true)
        const slow = entryMusic(accountInput.id, entries.find(e => e.name === 'slow-resume.mp3')!)
        await clearTrace(); await downloadQueue.enqueue([slow], { kind: 'local' })
        let id = downloadQueue.snapshot().jobs.at(-1)!.id
        await until(() => (downloadQueue.snapshot().jobs.find(j => j.id === id)?.received ?? 0) > 131072, 'Native transfer did not produce byte progress')
        await at('pause active native transfer')
        await downloadQueue.pause(id)
        assert(downloadQueue.snapshot().jobs.find(j => j.id === id)?.status === 'paused', 'Pause not persisted')
        await at('restart verified native transfer')
        await downloadQueue.retry(id)
        await at('wait for native receipt and durable completed queue')
        const job = await waitJob(id)
        await at('resolve completed local file')
        const local = await localDownloadPath(job.result!.path)
        await at('independent RNFS SHA verification')
        assert(await RNFS.hash(local, 'sha256') === job.result!.sha256, 'Local actual file SHA mismatch')
        await at('independent server range verification')
        assert((await trace()).some(e => e.path === 'audio/slow-resume.mp3' && e.status === 206 && e.validatedRange), 'No validated HTTP range was observed')
        await at('insert completed download into playlist')
        await addPublished(job.result!, playlist, job.music)
        return { received: job.result!.size, sha256: job.result!.sha256, validatedResume: true }
      }, 90000)
      await check('download to WebDAV uses complete readback verification and non-overwriting MOVE', async() => {
        const song = (await getListMusics(playlist)).find(s => s.source === 'local' && s.meta.ext === 'flac')!
        await downloadQueue.enqueue([song], { kind: 'webdav', accountId: accountInput.id, path: 'published/音乐' })
        const id = downloadQueue.snapshot().jobs.at(-1)!.id, job = await waitJob(id)
        const manifest = await control('manifest')
        assert(manifest[job.result!.path]?.sha256 === job.result!.sha256, 'Remote fixture bytes differ from native receipt')
        const audit = await trace()
        assert(audit.some(e => e.method === 'MOVE' && e.status === 201), 'No actual DAV MOVE')
        assert(!Object.keys(manifest).some(p => p.includes('.lx-upload-')), 'Staging file remains after completion')
        await addPublished(job.result!, playlist, song)
        return { size: job.result!.size, sha256: job.result!.sha256, destination: 'webdav' }
      })
      await check('complete encrypted backup includes large sharded app data, user files and own vault', async() => {
        await downloadQueue.pauseAll()
        await saveData(storageKey, { text: '完整应用数据'.repeat(120000), file: marker, expected: 'before-backup' })
        await RNFS.writeFile(marker, 'Persistent user file before backup', 'utf8')
        const full = await createEncryptedBackup('full', password, true)
        assert(full.kind === 'full' && full.name.endsWith('.lxbackup'), 'No complete encrypted backup')
        assert(await RNFS.hash(full.path, 'sha256') === full.sha256, 'Encrypted archive hash mismatch')
        await writeState({ playlist, entries, full })
        return { bytes: full.size, encryptedFile: true, largePayload: true }
      }, 90000)
      await check('encrypted backup upload and fetch preserve exact archive hash', async() => {
        const data = await saved(), remote = await uploadBackup(data.full!.path, accountInput.id, 'backups').promise
        const received = await fetchBackup(accountInput.id, remote.path).promise
        assert(await RNFS.hash(received.path, 'sha256') === data.full!.sha256, 'Backup DAV round-trip differs')
        return { roundTrip: true }
      }, 90000)
      await check('wrong backup password cannot change live application data', async() => {
        const data = await saved(); let failed = false
        try { await stageEncryptedRestore(data.full!.path, 'wrong-passphrase-88') } catch { failed = true }
        assert(failed && (await getData<any>(storageKey))?.expected === 'before-backup', 'Wrong password changed live data')
        assert((await restoreStatus()).state === 'none', 'Wrong password left an armed restore')
        return { rejected: true, originalRetained: true }
      }, 90000)
      await check('stage/arm full restore leaves modified live files untouched until cold boot', async() => {
        const data = await saved()
        await saveData(storageKey, { expected: 'after-backup' }); await RNFS.writeFile(marker, 'After backup mutation', 'utf8')
        const config = await refreshConfig(); await saveAccount({ ...config.accounts[0], password: 'changed-after-backup' })
        const staged = await stageEncryptedRestore(data.full!.path, password)
        assert(staged.state === 'prepared' && staged.kind === 'full' && staged.files! > 0, 'No authenticated full restore staged')
        assert((await getData<any>(storageKey))?.expected === 'after-backup' && await RNFS.readFile(marker, 'utf8') === 'After backup mutation', 'Stage prematurely changed live data')
        const ready = await armRestore(staged.id!); assert(ready.state === 'ready', 'Restore not durably armed')
        return { stagedFiles: staged.files, awaitsColdBoot: true }
      }, 90000)
    } else if (phase === 'full-restored') {
      await check('real cold-start full restore restores user file, huge storage and account credential', async() => {
        const status = await restoreStatus(); assert(status.state === 'awaitingAck', 'Native cold-start transaction did not apply')
        const value = await getData<any>(storageKey)
        assert(value.expected === 'before-backup' && value.text === '完整应用数据'.repeat(120000), 'Full app storage missing/truncated after restart')
        assert(await RNFS.readFile(marker, 'utf8') === 'Persistent user file before backup', 'User file not restored')
        const entries = await browseDirectory(accountInput.id, 'audio', true).promise
        assert(entries.some(e => e.name === 'tone.flac'), 'Restored Keychain credential does not authenticate')
        assert(downloadQueue.snapshot().jobs.every(j => j.status === 'completed' || j.status === 'paused'), 'Restored queue unexpectedly auto-started')
        const final = await acknowledgeRestore(); assert(final.state === 'restored', 'Restore not acknowledged')
        return { largePayloadLength: value.text.length, userFile: true, keychainAuthentication: true }
      })
      await check('playlist-only encrypted backup preserves non-playlist mutations on next cold start', async() => {
        const state = await saved()
        const playlistBackup = await createEncryptedBackup('playlists', password, false)
        await writeState({ ...state, playlistBackup })
        await overwriteListMusics(state.playlist, [])
        await saveData('@ci_playlist_unrelated', 'keep-new-preference')
        await RNFS.writeFile(marker, 'Keep new user file in playlist-only restore', 'utf8')
        const staged = await stageEncryptedRestore(playlistBackup.path, password)
        assert(staged.state === 'prepared' && staged.kind === 'playlists', 'No playlist-only staged archive')
        await armRestore(staged.id!); return { awaitingColdBoot: true }
      }, 90000)
    } else if (phase === 'playlists-restored') {
      await check('real cold-start playlist merge restores songs but preserves other software state', async() => {
        const state = await saved(), status = await restoreStatus()
        assert(status.state === 'awaitingAck' && status.kind === 'playlists', 'Playlist cold restore did not apply')
        assert((await getListMusics(state.playlist)).length >= 2, 'Songs not restored')
        assert(await getData('@ci_playlist_unrelated') === 'keep-new-preference', 'Playlist restore overwrote an unrelated setting')
        assert(await RNFS.readFile(marker, 'utf8') === 'Keep new user file in playlist-only restore', 'Playlist restore overwrote user file')
        await browseDirectory(accountInput.id, 'audio', true).promise
        const result = await acknowledgeRestore(); assert(result.state === 'restored', 'Playlist restore not acknowledged')
        return { playlistRestored: true, unrelatedValuesPreserved: true }
      })
    } else if (phase === 'offline') {
      const state = await saved(), songs = await getListMusics(state.playlist)
      for (const [format, quality] of [['mp3', '128k'], ['flac', 'flac']] as const) {
        await check(`${format} cached DAV music plays after real process restart with server unreachable`, async() => {
          const song = songs.find(s => getLibraryReference(s)?.path === `audio/tone.${format}`)!
          assert(song, 'Imported song missing'); return playback(song, quality)
        })
      }
    } else throw new Error('Unknown library test phase')
    await record(true)
  } catch (error) { await record(true, error) }
}
