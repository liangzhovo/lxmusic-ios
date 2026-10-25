import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { AccessibilityInfo, Animated, AppState, Easing, View, Platform, Image as NativeImage, requireNativeComponent, type ViewProps } from 'react-native'
import Image, { defaultHeaders, normalizeUri } from '@/components/common/Image'
import { useTheme } from '@/store/theme/hook'
import { useSettingValue } from '@/store/setting/hook'
import { useIsPlay } from '@/store/player/hook'
import { useNavigationComponentDidAppear, useNavigationComponentDidDisappear } from '@/navigation'
import { startCoverRotation } from './coverAnimation'

// Visual geometry is from the exact upstream CoverCD/CoverSquare, not a generic
// circular artwork: 5% inset, four 7% recessed mounts, 23.2% transparent hole.
// CoreGraphics implements the SVG's multiply/exclusion blends without new Pods.
const Disc = Platform.OS === 'ios' ? requireNativeComponent<ViewProps & {
  source: { uri: string, headers: Record<string, string> } | null
  discColor: string, hubColor: string, ringColor: string
}>('LXDiscArtwork') : null
const Mount = Platform.OS === 'ios' ? requireNativeComponent<ViewProps & {
  fillColor: string, shadeColor: string
}>('LXDiscMount') : null

export default memo(({ url, size, nativeID, componentId, active = true }: {
  url: string | number | null | undefined
  size: number
  nativeID?: string
  componentId: string
  active?: boolean
}) => {
  const theme = useTheme()
  const style = useSettingValue('playDetail.coverStyle')
  const playing = useIsPlay()
  const rotation = useRef(new Animated.Value(0)).current
  const [foreground, setForeground] = useState(AppState.currentState == 'active')
  const [visible, setVisible] = useState(true)
  // Do not animate until the accessibility preference is known.
  const [reduceMotion, setReduceMotion] = useState(true)
  useNavigationComponentDidAppear(componentId, useCallback(() => { setVisible(true) }, []))
  useNavigationComponentDidDisappear(componentId, useCallback(() => { setVisible(false) }, []))
  useEffect(() => {
    let mounted = true
    let motionEventSeen = false
    const app = AppState.addEventListener('change', state => { if (mounted) setForeground(state == 'active') })
    const motion = AccessibilityInfo.addEventListener('reduceMotionChanged', value => {
      if (!mounted) return
      motionEventSeen = true
      setReduceMotion(value)
    })
    void AccessibilityInfo.isReduceMotionEnabled().then(value => {
      if (mounted && !motionEventSeen) setReduceMotion(value)
    }).catch(() => {})
    return () => { mounted = false; app.remove(); motion.remove() }
  }, [])
  const enabled = style == 'cd' && playing && foreground && visible && active && !reduceMotion
  useEffect(() => startCoverRotation({
    stop: read => rotation.stopAnimation(read),
    set: value => rotation.setValue(value),
    run: (duration, complete) => {
      Animated.timing(rotation, { toValue: 1, duration, easing: Easing.linear, useNativeDriver: true })
        .start(({ finished }) => complete(finished))
    },
  }, enabled), [rotation, enabled])

  const width = Math.max(0, Number.isFinite(size) ? size : 0)
  if (style != 'cd') return <View testID="player-cover-square" style={{ width, height: width, borderRadius: 6,
    borderWidth: 1, borderColor: theme['c-primary-alpha-800'], backgroundColor: theme['c-primary-light-300-alpha-800'],
    shadowColor: theme['c-primary-dark-200'], shadowOpacity: 0.4, shadowRadius: 6, shadowOffset: { width: 0, height: 0 } }}>
    <Image url={url} nativeID={nativeID} style={{ width: Math.max(0, width - 2), height: Math.max(0, width - 2), borderRadius: 5 }} />
  </View>
  const disc = width * 0.9, mount = width * 0.07
  const uri = typeof url === 'number' ? NativeImage.resolveAssetSource(url)?.uri : normalizeUri(url)
  return <View testID="player-cover-cd" style={{ width, height: width, borderRadius: 6, opacity: 0.8,
    alignItems: 'center', justifyContent: 'center', backgroundColor: theme['c-primary-light-300-alpha-800'],
    shadowColor: theme['c-primary'], shadowOpacity: 0.5, shadowRadius: 6, shadowOffset: { width: 0, height: 0 } }}>
    {([['5%', '5%'], ['88%', '5%'], ['5%', '88%'], ['88%', '88%']] as const).map(([left, top], index) => Mount
      ? <Mount key={index} testID={`cd-mount-${index}`} pointerEvents="none" fillColor={theme['c-primary-light-300-alpha-800']} shadeColor={theme['c-primary-dark-300-alpha-800']}
          style={{ position: 'absolute', left, top, width: mount, height: mount }} />
      : <View key={index} style={{ position: 'absolute', left, top, width: mount, height: mount, borderRadius: mount / 2, backgroundColor: theme['c-primary-light-300-alpha-800'] }} />)}
    <Animated.View style={{ width: disc, height: disc, borderRadius: disc / 2,
      shadowColor: theme['c-primary'], shadowOpacity: 0.6, shadowRadius: 4, shadowOffset: { width: 0, height: 0 },
      transform: [{ rotate: rotation.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }}>
      {Disc ? <Disc testID="cd-source-artwork" nativeID={nativeID} pointerEvents="none" style={{ width: disc, height: disc }}
        source={typeof uri === 'string' && uri ? { uri, headers: defaultHeaders } : null}
        discColor={theme['c-primary-light-400']} hubColor={theme['c-primary-light-300-alpha-600']} ringColor={theme['c-primary-light-300']} />
        : <Image url={url} nativeID={nativeID} style={{ width: disc, height: disc, borderRadius: disc / 2 }} />}
    </Animated.View>
  </View>
})
