/**
 * 播放详情页 - 共享"桌面歌词"按钮（横/竖屏通用，方向差异由 variant 控制）
 */
import Btn from './Btn'
import { useSettingValue } from '@/store/setting/hook'
import DesktopLyricEnable, { type DesktopLyricEnableType } from '@/components/DesktopLyricEnable'
import { memo, useRef } from 'react'
import { toggleDesktopLyricLock } from '@/core/desktopLyric'
import { updateSetting } from '@/core/common'
import settingState from '@/store/setting/state'
import { isDesktopLyricSupported } from '@/utils/nativeModules/lyricDesktop'


export default memo(({ variant = 'horizontal' }: { variant?: 'horizontal' | 'vertical' }) => {
  const enabledLyric = useSettingValue('desktopLyric.enable')
  const desktopLyricEnableRef = useRef<DesktopLyricEnableType>(null)
  if (!isDesktopLyricSupported) return null
  const update = () => {
    desktopLyricEnableRef.current?.setEnabled(!enabledLyric)
  }
  const updateLock = () => {
    const isLock = !settingState.setting['desktopLyric.isLock']
    void toggleDesktopLyricLock(isLock).then(() => {
      updateSetting({ 'desktopLyric.isLock': isLock })
    })
  }

  return (
    <>
      <Btn icon={enabledLyric ? 'lyric-on' : 'lyric-off'} onPress={update} onLongPress={updateLock} variant={variant} />
      <DesktopLyricEnable ref={desktopLyricEnableRef} />
    </>
  )
})
