/**
 * 下载音质选择助手
 * 点击"下载"时弹出音质选择（按歌曲可用音质过滤），无可用列表时直接用设置里的优先音质
 */
import { Alert } from 'react-native'
import settingState from '@/store/setting/state'

const QUALITY_NAMES: Partial<Record<LX.Quality, string>> = {
  '128k': '标准音质 128k',
  '320k': '高品音质 320k',
  flac: '无损音质 FLAC',
  flac24bit: 'Hi-Res 24bit',
}

const STANDARD_QUALITYS: LX.Quality[] = ['128k', '320k', 'flac', 'flac24bit']

/** 获取歌曲可用下载音质列表（过滤出标准 4 种，源特化音质忽略） */
export const getAvailableQualitys = (musicInfo: { meta?: { qualitys?: unknown[] } }): LX.Quality[] => {
  const list = musicInfo.meta?.qualitys as unknown as Array<string | undefined> | undefined
  if (list?.length) {
    const qs = list.map(q => String(q ?? ''))
    return STANDARD_QUALITYS.filter(q => qs.includes(q))
  }
  return []
}

/**
 * 弹出音质选择对话框（始终弹出；音源未声明可用音质时提供标准 4 种，
 * 设置里的"优先播放的音质"排在最前作为默认推荐）
 */
export const showDownloadQualityDialog = (
  title: string,
  musicInfo: { meta?: { qualitys?: unknown[] } },
  onChoose: (quality: LX.Quality) => void,
) => {
  const qualitys = getAvailableQualitys(musicInfo)
  const preferred = settingState.setting['player.playQuality'] as LX.Quality | undefined
  const options = qualitys.length ? qualitys : STANDARD_QUALITYS
  const ordered = [...options].sort((a, b) => {
    if (a === preferred) return -1
    if (b === preferred) return 1
    return 0
  })

  const buttons: Array<{ text: string, onPress?: () => void, style?: 'default' | 'cancel' | 'destructive' }> = ordered.map(q => ({
    text: QUALITY_NAMES[q] ?? q,
    onPress: () => { onChoose(q) },
  }))
  buttons.push({ text: '取消', style: 'cancel' })
  Alert.alert('选择下载音质', title, buttons)
}
