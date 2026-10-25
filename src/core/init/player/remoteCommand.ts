import { onRemoteCommand, configureKeyboard } from '@/utils/nativeModules/utils'
import { pause, play, playNext, playPrev, togglePlay } from '@/core/player/player'
import { markTimeoutExitInteraction } from '@/core/player/timeoutExit'
import { setNavActiveId } from '@/core/common'
import { keyboardRouter } from '@/core/keyboardRouter'
import settingState from '@/store/setting/state'
import playerState from '@/store/player/state'
import commonState from '@/store/common/state'
import { popToRoot } from '@/navigation'
import { toast } from '@/utils/tools'

export default () => {
  const config = () => configureKeyboard({ enabled: settingState.setting['keyboard.enabled'],
    playback: settingState.setting['keyboard.playback'], seek: settingState.setting['keyboard.seek'],
    selection: settingState.setting['keyboard.selection'], navigation: settingState.setting['keyboard.navigation'] })
  config()
  global.state_event.on('configUpdated', config)
  onRemoteCommand(event => {
    const settings = settingState.setting
    const keyboard = event.source == 'keyboard'
    if (keyboard && !settings['keyboard.enabled']) return
    const command = event.command
    if (keyboard) {
      if (['toggle', 'next', 'previous'].includes(command) && !settings['keyboard.playback']) return
      if (command.startsWith('seek_') && !settings['keyboard.seek']) return
      if ((command.startsWith('select_') || command == 'locate_current') && !settings['keyboard.selection']) return
      if ((command.startsWith('nav_') || command == 'escape') && !settings['keyboard.navigation']) return
    }
    markTimeoutExitInteraction()
    switch (command) {
      case 'play': play(); break
      case 'pause': void pause().catch(() => toast('暂停失败')); break
      case 'toggle': togglePlay(); break
      case 'next': void playNext().catch(() => toast('切换歌曲失败')); break
      case 'previous': void playPrev().catch(() => toast('切换歌曲失败')); break
      case 'seek': if (typeof event.position == 'number') global.app_event.setProgress(event.position); break
      case 'seek_backward': case 'seek_forward': {
        if (!playerState.playMusicInfo.musicInfo || !playerState.progress.maxPlayTime) break
        const seconds = playerState.progress.nowPlayTime + (command == 'seek_forward' ? 5 : -5)
        global.app_event.setProgress(Math.max(0, Math.min(playerState.progress.maxPlayTime, seconds)))
        break
      }
      case 'select_up': case 'select_down': case 'select_enter': case 'locate_current': case 'escape':
        keyboardRouter.dispatch(command); break
      case 'nav_search': case 'nav_songlist': case 'nav_top': case 'nav_love': case 'nav_setting': {
        if (keyboardRouter.blocked) break
        setNavActiveId(command)
        const child = commonState.componentIds.playDetail || commonState.componentIds.songlistDetail || commonState.componentIds.comment
        if (child) void popToRoot(child).catch(() => {})
        break
      }
    }
  })
}
