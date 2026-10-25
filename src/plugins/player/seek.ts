import TrackPlayer from 'react-native-track-player'
import { NativeModules, Platform } from 'react-native'

const NativeTrackPlayerModule = NativeModules.TrackPlayerModule as {
  getPosition?: () => Promise<number>
}
const wait = async(ms: number) => new Promise(resolve => setTimeout(resolve, ms))
export const getAccuratePosition = async() => {
  if (Platform.OS == 'ios' && typeof NativeTrackPlayerModule?.getPosition == 'function') {
    return NativeTrackPlayerModule.getPosition()
  }
  return TrackPlayer.getPosition()
}

export const seekToTime = async(targetTime: number) => {
  if (!Number.isFinite(targetTime) || targetTime < 0) throw new Error('Invalid seek target')
  // Submit once. The old delayed "accuracy" loop resubmitted historical targets
  // while newer shortcuts were already seeking elsewhere, causing audible hops.
  await TrackPlayer.seekTo(targetTime)
  if (Platform.OS != 'ios') return targetTime

  let position = NaN
  let confirmations = 0
  for (const delay of [140, 200, 280, 360, 520]) {
    await wait(delay)
    position = await getAccuratePosition()
    if (Number.isFinite(position) && position >= 0 && Math.abs(position - targetTime) <= 1.2) {
      if (++confirmations >= 2) return position
    } else confirmations = 0
  }
  // This is an observed native position, never a simulated clock or a fallback
  // to the requested target. UI publication is guarded by the request revision.
  if (!Number.isFinite(position) || position < 0) throw new Error('Invalid native seek position')
  return position
}
