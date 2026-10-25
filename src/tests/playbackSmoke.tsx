import { runSeekBurstSmoke } from './seekBurstSmoke'
import { runSyncSmoke } from './syncSmoke'
import { runKeyboardSmoke } from './keyboardSmoke'
import TrackPlayer from 'react-native-track-player'
import React from 'react'
import { NativeModules, View, Text } from 'react-native'
import { Navigation } from 'react-native-navigation'
import RNFS from 'react-native-fs'
import { onAppLaunched } from '@/navigation/regLaunchedEvent'
import { initial } from '@/plugins/player'
import { getPosition, setPause, setPlay, setStop, setCurrentTime, setVolume } from '@/plugins/player/utils'
import { loadPlaybackResource } from '@/plugins/player/engine/resourceLoader'
import { initUnifiedPlayerEngine, onUnifiedPlayerEvent } from '@/plugins/player/engine'
import { lookupAudioCache, configureAudioCache, clearAudioCache, getAudioCacheSize } from '@/plugins/player/cache'
import settingState from '@/store/setting/state'
import { createI18n } from '@/lang'
import { createList, removeUserList, removeListMusics, getUserLists, setUserList } from '@/core/list'
import { getUserLists as getStoredLists, getListMusics as getStoredMusics } from '@/utils/data'
import { bootstrapLibrary, LOCAL_LIBRARY_ID } from '@/utils/libraryBootstrap'
import listState from '@/store/list/state'
import { clearSongResourceCache } from '@/core/music/cache'
import { saveMusicUrl, hasMusicUrlByMusic } from '@/utils/data'

const support = NativeModules.LXPlaybackTestSupport
const sleep = async(ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const bounded = async<T,>(task: Promise<T>, label: string, ms = 15000): Promise<T> => {
  let timer: ReturnType<typeof setTimeout>
  try { return await Promise.race([task, new Promise<never>((resolve, reject) => { timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms}ms`)), ms) })]) }
  finally { clearTimeout(timer!) }
}
const music = (kind: string): LX.Music.MusicInfoOnline => ({
  id: `ci-sine-${kind}`, name: `Generated ${kind} test tone`, singer: 'CI synthetic signal', source: 'kw', interval: '00:30',
  meta: { songId: `ci-${kind}`, albumName: 'CI', picUrl: '', qualitys: [], _qualitys: {} },
} as LX.Music.MusicInfoOnline)
export const run = async() => {
  const checks: Array<{ name: string, ok: boolean, detail?: unknown }> = []
  const probes: Array<{ label: string, started: number, elapsed?: number, value?: number }> = []
  const events: unknown[] = []
  let stage = 'launch'
  const record = async(done = false, error?: unknown) => {
    await support.record({ done, success: done && !error, phase: support.offline ? 'offline' : 'online', stage, checks, probes, events: events.slice(-30), error: error ? String(error) : undefined })
  }
  const check = async(name: string, fn: () => Promise<unknown>) => {
    stage = name; await record()
    const detail = await bounded(fn(), name, 20000)
    checks.push({ name, ok: true, detail: detail ?? null }); await record()
  }
  const assert = (value: unknown, message: string) => { if (!value) throw new Error(message) }
  const until = async(fn: () => Promise<boolean>, name: string, ms = 14000) => {
    const start = Date.now()
    while (Date.now() - start < ms) { if (await fn()) return; await sleep(250) }
    throw new Error(name)
  }
  const audibleTimeline = async(label: string) => {
    const position = async() => {
      const probe: typeof probes[number] = { label, started: Date.now() }
      probes.push(probe)
      await record()
      const value = await bounded(getPosition(), 'getPosition', 3000)
      probe.elapsed = Date.now() - probe.started; probe.value = value
      assert(Number.isFinite(value), 'Native position must be a finite number')
      return value
    }
    const initial = await position()
    await until(async() => (await position()) > initial + 0.25, `${label}: rendered position did not advance`)
    return position()
  }
  try {
    await new Promise<void>(resolve => onAppLaunched(resolve))
    if (support.uiPhase == 'system-theme' || support.uiPhase == 'system-theme-restart') {
      await import('./systemThemeSmoke').then(test => test.runSystemThemeSmoke(support.uiPhase == 'system-theme-restart'))
      return
    }
    if (support.uiPhase) {
      await import('./uiSmoke').then(test => test.runUI())
      return
    }
    global.i18n = createI18n('zh_cn')
    setUserList(await getUserLists())
    Navigation.registerComponent('LXPlaybackSmoke', () => () => <View><Text>Native playback regression test</Text></View>)
    await Navigation.setRoot({ root: { component: { name: 'LXPlaybackSmoke' } } })
    await check('scene-based window and minimal native window controls', async() => {
      const info = await support.windowSnapshot()
      assert(info.sceneAttached && info.sceneDelegate == 'LXSceneDelegate', JSON.stringify(info))
      assert(info.minimalWindowControls, `The configured scene is not using minimal window controls: ${JSON.stringify(info)}`)
      return info
    })
    await runKeyboardSmoke(check)
    await runSyncSmoke(check, !!support.offline)
    initUnifiedPlayerEngine()
    onUnifiedPlayerEvent(event => { events.push({ ...event, at: Date.now() }) })
    settingState.setting['player.cacheSize'] = '32'
    settingState.setting['player.volume'] = 0.4
    await check('real native player setup with persistent cache enabled', async() => {
      await initial({ volume: 0.4, playRate: 1, cacheSize: 32, isHandleAudioFocus: true, isEnableAudioOffload: false })
      await configureAudioCache(32)
      const position = await bounded(getPosition(), 'idle native getPosition', 3000)
      return { idlePosition: position, nativePositionExport: typeof NativeModules.TrackPlayerModule?.getPosition }
    })
    const formats = [['mp3', '128k'], ['flac', 'flac']] as const
    if (!support.offline) {
      await clearAudioCache()
      await check('real native storage persists list and song removal', async() => {
        await bootstrapLibrary(() => listState.allList.some(l => l.id == LOCAL_LIBRARY_ID),
          async() => createList({ id: LOCAL_LIBRARY_ID, name: '本地音乐' }))
        await removeUserList([LOCAL_LIBRARY_ID])
        await createList({ id: 'ci-list-removed', name: 'CI removed list', list: [music('mp3')] })
        await removeUserList(['ci-list-removed'])
        await createList({ id: 'ci-list-kept', name: 'CI kept list', list: [music('mp3'), music('flac')] })
        await removeListMusics('ci-list-kept', [music('mp3').id])
        assert(!(await getStoredLists()).some(l => ['ci-list-removed', LOCAL_LIBRARY_ID].includes(l.id)), 'Removed list remains on disk')
        const kept = await getStoredMusics('ci-list-kept')
        assert(kept.length == 1 && kept[0].id == music('flac').id, 'Song removal not persisted')
        return { removed: ['ci-list-removed', LOCAL_LIBRARY_ID], keptSongs: kept.map(s => s.id) }
      })
      for (const [format, quality] of formats) {
        const info = music(format)
        const url = `http://127.0.0.1:18779/tone.${format}`
        await check(`${format}: cold remote stream actually advances`, async() => {
          await loadPlaybackResource({ musicInfo: info, url, time: 0, quality })
          return audibleTimeline(format)
        })
        await check(`${format}: output gain matches application volume`, async() => {
          const values: unknown[] = []
          if (format == 'flac') {
            let fullRMS = 0
            for (const level of [1, 0.5, 1]) {
              await setVolume(level)
              const before = await NativeModules.StreamingFlacPlayerModule.getOutputMetrics()
              await until(async() => (await NativeModules.StreamingFlacPlayerModule.getOutputMetrics()).blocks > before.blocks + 4, 'No post-mix PCM output')
              const metrics = await NativeModules.StreamingFlacPlayerModule.getOutputMetrics()
              assert(Math.abs(metrics.appliedVolume - level) < 0.01, 'FLAC gain is different from requested')
              assert(metrics.masterVolume == 1 && metrics.dryVolume == 1, 'Unexpected bypass attenuation')
              // Generated sine: peak 6000/32768. Allow mono-to-stereo pan law,
              // but reject large unexplained output loss or fixed extra gain.
              if (level == 1) {
                assert(metrics.rms > 0.07 && metrics.rms < 0.16, `FLAC RMS out of range: ${metrics.rms}`)
                fullRMS = metrics.rms
              } else assert(metrics.rms / fullRMS > 0.40 && metrics.rms / fullRMS < 0.60, 'Volume not linear or applied twice')
              values.push({ level, ...metrics })
            }
          } else {
            for (const level of [1, 0.5, 1]) {
              await setVolume(level)
              const applied = await TrackPlayer.getVolume()
              assert(Math.abs(applied - level) < 0.01, `AVPlayer volume mismatch: ${applied}`)
              values.push({ level, applied })
            }
          }
          await setVolume(settingState.setting['player.volume'])
          return values
        })
        await check(`${format}: pause and resume`, async() => {
          await setPause(); await sleep(250)
          const before = await getPosition(); await sleep(450)
          assert(Math.abs((await getPosition()) - before) < 0.18, 'Position advanced while paused')
          await setPlay(); return audibleTimeline(`${format} resume`)
        })
        await check(`${format}: real RNFS complete cache published without stopping playback`, async() => {
          await until(async() => !!await lookupAudioCache(info, quality), 'Complete cache was never published', 16000)
          return getAudioCacheSize()
        })
        await check(`${format}: local cache playback and seek`, async() => {
          const local = await lookupAudioCache(info, quality)
          assert(local?.startsWith('file://'), 'No complete local URL')
          await loadPlaybackResource({ musicInfo: info, url: local!, time: 0, quality })
          await audibleTimeline(`${format} local`)
          await setCurrentTime(3)
          await until(async() => (await getPosition()) > 3.25, 'Seek/resume position did not advance')
          return getPosition()
        })
        await runSeekBurstSmoke(check, format, info)
      }
      await check('switch FLAC to MP3 without a zero-seek deadlock', async() => {
        await loadPlaybackResource({ musicInfo: music('mp3'), url: (await lookupAudioCache(music('mp3'), '128k'))!, time: 0, quality: '128k' })
        return audibleTimeline('switch')
      })
      // Each replacement has its own timeout; six loads must not share one.
      for (let pass = 0; pass < 3; pass++) {
        for (const source of ['remote', 'cache']) {
          await check(`repeated remote/cache transition ${pass} ${source}`, async() => {
            const url = source == 'remote' ? 'http://127.0.0.1:18779/tone.mp3' : await lookupAudioCache(music('mp3'), '128k')
            assert(url, 'Completed MP3 required for transition stress')
            await loadPlaybackResource({ musicInfo: music('mp3'), url: url!, time: 0, quality: '128k' })
            return { pass, source, position: await audibleTimeline(`transition ${pass} ${source}`) }
          })
        }
      }
    } else {
      await check('second app process does not restore removed lists or songs', async() => {
        let recreated = false
        await bootstrapLibrary(() => listState.allList.some(l => l.id == LOCAL_LIBRARY_ID), async() => { recreated = true })
        assert(!recreated, 'Local library recreated after removal')
        const stored = await getStoredLists()
        assert(!stored.some(l => ['ci-list-removed', LOCAL_LIBRARY_ID].includes(l.id)), 'Removed list restored on restart')
        const kept = await getStoredMusics('ci-list-kept')
        assert(kept.length == 1 && kept[0].id == music('flac').id, 'Removed song restored on restart')
        return { persisted: stored.map(l => l.id), songs: kept.map(s => s.id) }
      })
      for (const [format, quality] of formats) {
        await check(`${format}: second app process offline cache playback`, async() => {
          const local = await lookupAudioCache(music(format), quality)
          assert(local?.startsWith('file://'), 'Restart lost the completed file')
          assert(await RNFS.exists(decodeURIComponent(local!.slice(7))), 'Local cache file missing')
          await loadPlaybackResource({ musicInfo: music(format), url: local!, time: 0, quality })
          return audibleTimeline(`${format} offline restart`)
        })
      }
      await check('1.9.0 single-song clear removes URLs and complete FLAC while preserving MP3 and playing lease', async() => {
        await saveMusicUrl(music('flac'), 'flac', 'https://invalid.example/old-token')
        await saveMusicUrl(music('flac'), '320k', 'https://invalid.example/old-token2')
        await clearSongResourceCache(music('flac'))
        assert(!await hasMusicUrlByMusic(music('flac')), 'Per-song URL cache remains')
        assert(!await lookupAudioCache(music('flac'), 'flac'), 'Per-song audio cache remains')
        assert(!!await lookupAudioCache(music('mp3'), '128k'), 'Other song cache was deleted')
        return audibleTimeline('playing during per-song clear')
      })
      await check('clear cache preserves the active FLAC playback lease' , async() => {
        await clearAudioCache()
        assert((await getAudioCacheSize()) == 0, 'Cache not cleared')
        return audibleTimeline('playing during clear')
      })
    }
    await setStop()
    await record(true)
  } catch (error) {
    checks.push({ name: stage, ok: false, detail: String(error) })
    await record(true, error)
  }
}
