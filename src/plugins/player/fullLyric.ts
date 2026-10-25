import { Platform } from 'react-native'
import settingState from '@/store/setting/state'
import playerState from '@/store/player/state'

// Full Bluetooth lyrics use an Android metadata extension. iOS keeps its
// existing per-line lock-screen lyrics; it must not advertise an unsupported switch.
export const getCurrentFullLyric = (targetId: string | null) => (
  Platform.OS == 'android' && settingState.setting['player.isShowBluetoothFullLyric'] &&
  targetId && playerState.musicInfo.id == targetId && playerState.musicInfo.lrc
    ? playerState.musicInfo.lrc : undefined
)
