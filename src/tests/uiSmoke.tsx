import { KeyboardConfigurationDialog } from '@/screens/Home/Views/Setting/settings/Basic/KeyboardShortcuts'
import type { DialogType } from '@/components/common/Dialog'
import { PlaylistContents } from '@/screens/PlayDetail/Horizontal/components/PlaylistBtn'
import { playingColor, playingColorChroma, playingColorDistance, songSurface } from '@/utils/playingColor'
import { contrastRatio } from '@/utils/readability'
import { readableThemeWithAccent } from '@/utils/themeAccent'
import { overlaySurface } from '@/utils/overlaySurface'
import playerActions from '@/store/player/action'
import { applyTheme } from '@/core/theme'
import { applyNavigationAppearance, navigationAppearance } from '@/navigation/appearance'
import themes from '@/theme/themes/themes'
import themeState from '@/store/theme/state'
import { Provider } from '@/store/Provider'
import commonState from '@/store/common/state'
import { COMPONENT_IDS } from '@/config/constant'
import HorizontalHeader from '@/screens/Home/Horizontal/Header'
import Mylist from '@/screens/Home/Views/Mylist'
import Menu, { type MenuType } from '@/components/common/Menu'
import ListActionBar from '@/components/common/ListActionBar'
import NavigationTabs from '@/screens/Home/Vertical/NavigationTabs'
import { updateSetting } from '@/core/common'
// Deterministic, simulator-only rendering evidence. Uses real production views;
// fixture content is synthetic and does not contact music services.
import React, { useEffect, useRef } from 'react'
import { Dimensions, NativeModules, View } from 'react-native'
import { Navigation } from 'react-native-navigation'
import { createI18n } from '@/lang'
import { windowSizeTools } from '@/utils/windowSizeTools'
import PageContent from '@/components/PageContent'
import Text from '@/components/common/Text'
import OnlineList, { type OnlineListType } from '@/components/OnlineList'
import MusicAddModal, { type MusicAddModalType } from '@/components/MusicAddModal'
import Popup, { type PopupType } from '@/components/common/Popup'
import SettingPopup, { type SettingPopupType } from '@/screens/PlayDetail/components/SettingPopup'
import Aside from '@/screens/Home/Horizontal/Aside'
import { useHorizontalMode } from '@/utils/hooks'
import { useTheme } from '@/store/theme/hook'
import { createList, getUserLists, setUserList, overwriteListMusics } from '@/core/list'
import { initial } from '@/plugins/player'

const support = NativeModules.LXPlaybackTestSupport
const requestedPalette = /^palette-(.+)$/.exec(support.uiPhase)?.[1]
const phase: string = requestedPalette ? 'table' : support.uiPhase.replace(/^dark/, '')
const selectTheme = (dark: boolean) => {
  const theme = (requestedPalette ? themes.find(item => item.id == requestedPalette) : themes.find(item => item.isDark == dark))!
  applyTheme(JSON.parse(JSON.stringify(theme)))
  applyNavigationAppearance(dark)
}
let geometry: unknown = null
const songs = Array.from({ length: 100 }, (_, i) => ({
  id: `ci-ui-${i}`, name: ['一路生花', '天空之外', '风吹麦浪', '远方的声音'][i % 4],
  singer: ['测试歌手', '纯音乐作品', '艺术家示例'][i % 3], interval: '04:32', source: 'kw',
  meta: { songId: `ci-ui-${i}`, albumName: '专辑名称 · 阅读与列对齐验证', picUrl: '', qualitys: [], _qualitys: {} },
} as LX.Music.MusicInfoOnline))

const Fixture = () => {
  const wide = useHorizontalMode()
  const theme = useTheme()
  const list = useRef<OnlineListType>(null)
  const menu = useRef<MenuType>(null)
  const favorite = useRef<MusicAddModalType>(null)
  const popup = useRef<PopupType>(null)
  const settings = useRef<SettingPopupType>(null)
  const keyboard = useRef<DialogType>(null)
  useEffect(() => {
    list.current?.setList(songs, false, true)
    list.current?.setStatus('end')
    const timer = setTimeout(() => {
      if (phase == 'menu') menu.current?.show({ x: Dimensions.get('window').width - 50, y: 210, w: 44, h: 44 })
      if (phase == 'favorites') favorite.current?.show({ musicInfo: songs[0], listId: '', isMove: false })
      if (phase == 'list') popup.current?.setVisible(true)
      if (phase == 'settings') settings.current?.show()
      if (phase == 'keyboard') keyboard.current?.setVisible(true)
    }, 600)
    const switchTimer = setTimeout(() => {
      if (phase == 'themeswitch') selectTheme(true)
      if (phase == 'lightagain') selectTheme(false)
    }, 1100)
    const report = setTimeout(() => {
      void support.windowSnapshot().then((native: { sceneAttached: boolean, minimalWindowControls: boolean, statusBarStyle: number, deviceIdiom: number }) => {
        const expectedDark = themeState.theme.isDark
        const styleOK = expectedDark ? native.statusBarStyle == 1 : [0, 3].includes(native.statusBarStyle)
        const actualTheme = readableThemeWithAccent(themeState.theme)
        const background = songSurface(actualTheme), foreground = playingColor(actualTheme)
        const colour = { background, foreground, normal: actualTheme['c-font'], secondary: actualTheme['c-font-label'],
          contrast: contrastRatio(foreground, background), chroma: playingColorChroma(foreground, background),
          normalDistance: playingColorDistance(foreground, actualTheme['c-font'], background),
          secondaryDistance: playingColorDistance(foreground, actualTheme['c-font-label'], background) }
        const colourOK = colour.contrast >= 4.8 && colour.chroma >= .085 && colour.chroma <= .18 && colour.normalDistance >= .16 && colour.secondaryDistance >= .10
        const accents = (['c-primary-font', 'c-primary-font-active', 'c-primary-font-hover'] as const).map(role => {
          const value = actualTheme[role]
          return { role, foreground: value, contrast: contrastRatio(value, background),
            chroma: playingColorChroma(value, background),
            normalDistance: playingColorDistance(value, actualTheme['c-font'], background),
            secondaryDistance: playingColorDistance(value, actualTheme['c-font-label'], background) }
        })
        const accentsOK = accents.every(c => c.contrast >= 4.8 && c.chroma >= .085 && c.chroma <= .18 && c.normalDistance >= .16 && c.secondaryDistance >= .10)
        const menuBackground = overlaySurface(actualTheme).backgroundColor as string
        const menuForeground = playingColor(actualTheme, menuBackground)
        const menuAccent = { background: menuBackground, foreground: menuForeground,
          contrast: contrastRatio(menuForeground, menuBackground), chroma: playingColorChroma(menuForeground, menuBackground),
          normalDistance: playingColorDistance(menuForeground, actualTheme['c-font'], menuBackground),
          secondaryDistance: playingColorDistance(menuForeground, actualTheme['c-font-label'], menuBackground) }
        const menuAccentOK = menuAccent.contrast >= 4.8 && menuAccent.chroma >= .085 && menuAccent.chroma <= .18 && menuAccent.normalDistance >= .16 && menuAccent.secondaryDistance >= .10
        return support.record({ done: true, success: native.sceneAttached && native.minimalWindowControls && styleOK && colourOK && accentsOK && menuAccentOK, colour, accents, menuAccent,
          phase: support.uiPhase, expectedDark, native, geometry, width: Dimensions.get('window').width,
          height: Dimensions.get('window').height, fixture: 'production views with synthetic data', wide })
      })
    }, 2800)
    return () => { clearTimeout(timer); clearTimeout(report); clearTimeout(switchTimer) }
  }, [wide])
  return <PageContent>
    <View style={{ flex: 1, flexDirection: 'row' }}>
      {wide ? <Aside /> : null}
      {phase != 'library' && wide ? <View style={{ width: 208, borderRightWidth: .5, borderColor: theme['c-border-background'], padding: 16 }}>
        <Text size={17} style={{ fontWeight: '600', marginBottom: 24 }}>排行榜</Text>
        {['飙升榜', '新歌榜', '热歌榜', '我的收藏'].map(name => <Text key={name} size={14} style={{ marginBottom: 24 }}>{name}</Text>)}
      </View> : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        {phase == 'library' ? <><HorizontalHeader /><Mylist /></> : <>
        <View style={{ minHeight: 76, padding: 16, flexDirection: 'row', alignItems: 'center' }}>
          <Text size={18} style={{ flex: 1, fontWeight: '600' }}>热歌榜 · 单行歌曲列表</Text>
          {wide ? <View style={{ width: 250, maxWidth: '65%' }}><ListActionBar actions={[{ label: '播放全部', onPress: () => {} }, { label: '收藏歌单', onPress: () => {} }]} /></View> : null}
        </View>
        <OnlineList ref={list} onRefresh={() => {}} onLoadMore={() => {}} />
        </>}
      </View>
    </View>
    {!wide ? <NavigationTabs /> : null}
    <Menu ref={menu} activeId="add" menus={[{ action: 'play', label: '播放' }, { action: 'add', label: '添加到列表' }, { action: 'detail', label: '歌曲详细信息' }, { action: 'long', label: '将歌曲添加到其他收藏列表' }, { action: 'remove', label: '移除' }]} onPress={() => {}} />
    <MusicAddModal ref={favorite} />
    <Popup ref={popup} kind="player-playlist" title="播放列表">
      <PlaylistContents list={songs} visible={phase == 'list'} onSelect={song => { playerActions.setPlayMusicInfo('default', song); playerActions.setIsPlay(true) }} />
    </Popup>
    <KeyboardConfigurationDialog ref={keyboard} />
    <SettingPopup ref={settings} direction={wide ? 'horizontal' : 'vertical'} />
  </PageContent>
}

export const runUI = async() => {
  global.i18n = createI18n('zh_cn')
  await windowSizeTools.init()
  updateSetting({ 'common.hidePortraitNavigation': support.uiPhase == 'navhidden' })
  setUserList(await getUserLists())
  // Table views put the current song in the visible viewport; the queue still
  // uses a distant row so its automatic location is exercised.
  playerActions.setPlayMusicInfo('default', songs[phase == 'list' || phase == 'library' ? 65 : 3])
  playerActions.setIsPlay(true)
  await overwriteListMusics('default', songs)
  commonState.navActiveId = phase == 'library' ? 'nav_love' : 'nav_top'
  selectTheme(support.uiPhase.startsWith('dark') || phase == 'lightagain')
  await createList({ id: 'ci-ui-favorite-a', name: '本地音乐' })
  await createList({ id: 'ci-ui-favorite-b', name: '通勤音乐' })
  await initial({ volume: 1, playRate: 1, cacheSize: 0, isHandleAudioFocus: true, isEnableAudioOffload: false })
  const landscape = support.uiOrientation == 'landscape'
  const options = { ...navigationAppearance(themeState.theme.isDark),
    layout: { orientation: [landscape ? 'landscape' : 'portrait'] as Array<'landscape' | 'portrait'> } }
  // The external XCTest driver rotates the real simulated device. Windowed
  // iPad scenes may reject requestGeometryUpdate even when the app supports all
  // orientations. Keep actual Dimensions and let the runner verify the result.
  geometry = await support.windowSnapshot()
  Navigation.registerComponent('LXUIReview', () => () => <Provider><Fixture /></Provider>)
  await Navigation.setRoot({ root: { component: { id: 'LXUIReview', name: 'LXUIReview', options } } })
  commonState.componentIds[COMPONENT_IDS.home] = 'LXUIReview'
  applyNavigationAppearance(themeState.theme.isDark)
}
