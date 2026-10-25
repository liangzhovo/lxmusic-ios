import { StyleSheet, View } from 'react-native'
import { useTheme } from '@/store/theme/hook'
import ImageBackground from '@/components/common/ImageBackground'
import { useWindowSize } from '@/utils/hooks'
import { useMemo } from 'react'
import { scaleSizeAbsHR } from '@/utils/pixelRatio'
import { defaultHeaders } from './common/Image'
import SizeView from './SizeView'
import { useBgPic } from '@/store/common/hook'
import WindowContent from './WindowContent'

interface Props {
  children: React.ReactNode
  // Kept for source compatibility. All screens now use vertical avoidance;
  // this flag no longer permits controls to bypass the system safe area.
  integrateWindowControls?: boolean
}

const BLUR_RADIUS = Math.max(scaleSizeAbsHR(18), 10)

export default ({ children }: Props) => {
  const theme = useTheme()
  const windowSize = useWindowSize()
  const pic = useBgPic()

  const themeComponent = useMemo(() => (
    <View style={{ flex: 1, overflow: 'hidden' }}>
      <ImageBackground
        style={{ position: 'absolute', left: 0, top: 0, height: windowSize.height, width: windowSize.width, backgroundColor: theme['c-content-background'] }}
        source={theme['bg-image']}
        resizeMode="cover"
      />
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: theme['c-main-background'] }]} />
      <WindowContent>{children}</WindowContent>
    </View>
  ), [children, theme, windowSize.height, windowSize.width])

  const picComponent = useMemo(() => (
    <View style={{ flex: 1, overflow: 'hidden' }}>
      <ImageBackground
        style={{ position: 'absolute', left: 0, top: 0, height: windowSize.height, width: windowSize.width, backgroundColor: theme['c-content-background'] }}
        source={{ uri: pic!, headers: defaultHeaders }}
        resizeMode="cover"
        blurRadius={BLUR_RADIUS}
      />
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: theme['c-content-background'], opacity: 0.76 }]} />
      <WindowContent>{children}</WindowContent>
    </View>
  ), [children, pic, theme, windowSize.height, windowSize.width])

  return <><SizeView />{pic ? picComponent : themeComponent}</>
}
