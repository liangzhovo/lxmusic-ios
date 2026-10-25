import { NativeModules } from 'react-native'
import initPlayProgress from '@/core/init/player/playProgress'
import playerState from '@/store/player/state'
import playerActions from '@/store/player/action'
import { getPosition, setCurrentTime, setPause, setPlay } from '@/plugins/player/utils'
import { updateSetting } from '@/core/common'

type Check = (name: string, fn: () => Promise<unknown>) => Promise<void>
const sleep = async(ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const position = async() => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([getPosition(), new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('burst getPosition exceeded 3000ms')), 3000)
    })])
  } finally { clearTimeout(timer) }
}
export const runSeekBurstSmoke = async(check: Check, format: string, musicInfo: LX.Music.MusicInfoOnline) => {
  await check(`${format}: real keyboard burst keeps only the latest seek target`, async() => {
    const assert = (value: unknown, message: string) => { if (!value) throw new Error(message) }
    const until = async(test: () => Promise<boolean>, message: string) => {
      for (let i = 0; i < 60; i++) { if (await test()) return; await sleep(100) }
      throw new Error(message)
    }
    const requests: number[] = [], ui: number[] = []
    const onRequest = (time: number) => { requests.push(time) }
    const onProgress: typeof global.state_event.playProgressChanged = progress => { ui.push(progress.nowPlayTime) }
    await setPause()
    await setCurrentTime(3)
    playerActions.setMusicInfo({ id: musicInfo.id })
    playerActions.setPlayMusicInfo(null, musicInfo, true)
    playerActions.setProgress(3, 30)
    playerActions.setIsPlay(true)
    updateSetting({ 'keyboard.enabled': true, 'keyboard.seek': true })
    const cleanup = initPlayProgress()
    global.app_event.on('setProgress', onRequest)
    global.state_event.on('playProgressChanged', onProgress)
    try {
      await setPlay()
      global.app_event.play()
      await sleep(80)
      const commands = ['seek_forward', 'seek_forward', 'seek_backward', 'seek_forward', 'seek_backward', 'seek_forward']
      await Promise.all(commands.map(command => NativeModules.LXPlaybackTestSupport.sendKeyboard(command)))
      await until(async() => requests.length == commands.length, 'Native shortcuts did not reach production progress listener')
      const target = requests[requests.length - 1]
      const settledStart = ui.length
      assert(target > 10 && target < 17, `Relative targets did not accumulate: ${requests.join(',')}`)
      await until(async() => { const p = await position(); return p >= target - 0.5 && p <= target + 3 }, 'Burst did not reach latest native target')
      await sleep(1600)
      const actual = await position()
      assert(actual > target + 0.25, 'Native playback did not advance after burst')
      assert(ui.slice(settledStart).every(p => p >= target - 0.5), `Expired progress overwrote latest target: ${ui.join(',')}`)
      return { commands, requests, target, nativePosition: actual, uiAfterBurst: ui.slice(settledStart) }
    } finally {
      global.app_event.pause()
      cleanup()
      global.app_event.off('setProgress', onRequest)
      global.state_event.off('playProgressChanged', onProgress)
    }
  })
}
