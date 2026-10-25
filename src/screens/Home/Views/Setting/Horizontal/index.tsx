import { useRef } from 'react'
import { ScrollView, View } from 'react-native'
import NavList from './NavList'
import Main, { type MainType } from '../Main'
import { createStyle } from '@/utils/tools'
import { BorderWidths } from '@/theme'
import { useTheme } from '@/store/theme/hook'
import { useWindowSize } from '@/utils/hooks'

const styles = createStyle({
  container: {
    flex: 1,
    flexDirection: 'row',
    borderTopWidth: BorderWidths.normal,
  },
  nav: {
    height: '100%',
    borderRightWidth: BorderWidths.normal,
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    flexGrow: 1,
    alignItems: 'center',
  },
  main: {
    width: '100%',
    paddingLeft: 15,
    paddingRight: 15,
    paddingTop: 15,
    paddingBottom: 15,
    flex: 0,
  },
})

export default () => {
  const theme = useTheme()
  const mainRef = useRef<MainType>(null)
  const { width: windowWidth } = useWindowSize()
  const expanded = windowWidth >= 900
  const navWidth: number | `${number}%` = expanded
    ? Math.min(Math.max(windowWidth * 0.2, 200), 260)
    : '22%'

  return (
    <View style={{ ...styles.container, borderTopColor: theme['c-border-background'] }}>
      <View style={{ ...styles.nav, width: navWidth, borderRightColor: theme['c-border-background'] }}>
        <NavList onChangeId={(id) => mainRef.current?.setActiveId(id)} />
      </View>
      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
        keyboardShouldPersistTaps={'always'}
      >
        <View style={{ ...styles.main, maxWidth: expanded ? 760 : undefined }}>
          <Main ref={mainRef} />
        </View>
      </ScrollView>
    </View>
  )
}
