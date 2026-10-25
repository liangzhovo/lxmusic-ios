import { KeyboardPage } from '@/components/KeyboardScope'
import { Platform, View } from 'react-native'
import Text from '@/components/common/Text'
import { useEffect, useRef, useState } from 'react'
import settingState from '@/store/setting/state'
import MusicList from './MusicList'
import MyList from './MyList'
import { useTheme } from '@/store/theme/hook'
import DrawerLayoutFixed, { type DrawerLayoutFixedType } from '@/components/common/DrawerLayoutFixed'
import { COMPONENT_IDS } from '@/config/constant'
import { scaleSizeW } from '@/utils/pixelRatio'
import type { InitState as CommonState } from '@/store/common/state'
import { useHorizontalMode, useWindowSize } from '@/utils/hooks'

const MAX_WIDTH = scaleSizeW(400)

const LegacyDrawer = () => {
  const drawer = useRef<DrawerLayoutFixedType>(null)
  const theme = useTheme()
  const { width: windowWidth } = useWindowSize()
  const expanded = windowWidth >= 900

  useEffect(() => {
    const handleFixDrawer = (id: CommonState['navActiveId']) => {
      if (id == 'nav_love') drawer.current?.fixWidth()
    }
    const changeVisible = (visible: boolean) => {
      if (visible) {
        requestAnimationFrame(() => {
          drawer.current?.openDrawer()
        })
      } else {
        drawer.current?.closeDrawer()
      }
    }

    global.state_event.on('navActiveIdUpdated', handleFixDrawer)
    global.app_event.on('changeLoveListVisible', changeVisible)

    return () => {
      global.state_event.off('navActiveIdUpdated', handleFixDrawer)
      global.app_event.off('changeLoveListVisible', changeVisible)
    }
  }, [])

  const navigationView = () => <MyList />

  return (
    <DrawerLayoutFixed
      ref={drawer}
      visibleNavNames={[COMPONENT_IDS.home]}
      widthPercentage={expanded ? 0.34 : 0.82}
      widthPercentageMax={expanded ? 340 : MAX_WIDTH}
      drawerPosition={settingState.setting['common.drawerLayoutPosition']}
      renderNavigationView={navigationView}
      drawerBackgroundColor={theme['c-content-background']}
      style={{ elevation: 1 }}
    >
      <MusicList />
    </DrawerLayoutFixed>
  )
}

const IOSLibrary = () => {
  const theme = useTheme()
  const [width, setWidth] = useState(0)
  const horizontal = useHorizontalMode()
  const sidebar = horizontal && width >= 700
  return <View style={{ flex: 1, minHeight: 0 }} onLayout={event => setWidth(event.nativeEvent.layout.width)}>
    <View style={{ flex: 1, minHeight: 0, flexDirection: sidebar ? 'row' : 'column' }}>
      {sidebar ? <View style={{ width: 208, borderRightWidth: 0.5, borderRightColor: theme['c-border-background'] }}>
        <Text size={13} style={{ paddingHorizontal: 14, paddingVertical: 10 }}>我的列表</Text>
        <MyList />
      </View> : null}
      <View style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
        <MusicList listSelector={sidebar ? undefined : <MyList compact />} />
      </View>
    </View>
  </View>
}
const Page = () => Platform.OS == 'ios' ? <IOSLibrary /> : <LegacyDrawer />

export default () => <KeyboardPage navId="nav_love"><Page /></KeyboardPage>
