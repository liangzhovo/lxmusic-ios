import { createContext, useContext, useState, type ReactNode } from 'react'
import { Platform, SafeAreaView, StyleSheet, View, UIManager, requireNativeComponent, type ViewProps, type NativeSyntheticEvent, type LayoutChangeEvent } from 'react-native'

// Complete native clearance, not a second 36/40-point title strip.
// System window controls stay in their UIKit-owned top-leading position.
export const getWindowControlTopPadding = (safeTop: number): number => (
  Number.isFinite(safeTop) ? Math.max(0, safeTop) : 0
)
const ConsumedInsets = createContext(false)
// A React Native Modal has its own native root; never inherit the parent's
// consumed flag across that boundary. Nested panels in one root consume once.
export const WindowInsetsScope = ({ children }: { children: ReactNode }) => (
  <ConsumedInsets.Provider value={false}>{children}</ConsumedInsets.Provider>
)
type Insets = { top: number, bottom: number }
const NativeInsets = Platform.OS == 'ios' && Platform.isPad && UIManager.getViewManagerConfig('LXWindowInsets')
  ? requireNativeComponent<ViewProps & { onInsetsChange: (event: NativeSyntheticEvent<Insets>) => void }>('LXWindowInsets')
  : null

export default ({ children }: { children: ReactNode }) => {
  const consumed = useContext(ConsumedInsets)
  const [outerHeight, setOuterHeight] = useState(0)
  const [safeFrame, setSafeFrame] = useState({ y: 0, height: 0 })
  const [nativeInsets, setNativeInsets] = useState<Insets | null>(null)
  if (Platform.OS != 'ios' || consumed) return <>{children}</>
  if (!Platform.isPad) return <SafeAreaView style={styles.fill}><ConsumedInsets.Provider value>{children}</ConsumedInsets.Provider></SafeAreaView>

  const handleSafeLayout = ({ nativeEvent }: LayoutChangeEvent) => {
    const { y, height } = nativeEvent.layout
    const nextTop = Math.max(0, y)
    setSafeFrame(previous => Math.abs(previous.y - nextTop) < 0.5 && Math.abs(previous.height - height) < 0.5
      ? previous : { y: nextTop, height })
  }
  const safeTop = nativeInsets?.top ?? safeFrame.y
  const top = getWindowControlTopPadding(safeTop)
  const bottom = nativeInsets?.bottom ?? (safeFrame.height > 0 ? Math.max(0, outerHeight - safeFrame.y - safeFrame.height) : 0)
  return (
    <View style={styles.fill} onLayout={event => setOuterHeight(event.nativeEvent.layout.height)}>
      {NativeInsets ? <NativeInsets style={styles.probe} pointerEvents="none" onInsetsChange={({ nativeEvent }) => {
        const next = { top: Math.max(0, nativeEvent.top), bottom: Math.max(0, nativeEvent.bottom) }
        setNativeInsets(previous => previous?.top == next.top && previous?.bottom == next.bottom ? previous : next)
      }} /> : (
        <SafeAreaView pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.probe}>
          <View style={styles.fill} onLayout={handleSafeLayout} />
        </SafeAreaView>
      )}
      <View style={[styles.fill, { paddingTop: top, paddingBottom: bottom }]}>
        <ConsumedInsets.Provider value>{children}</ConsumedInsets.Provider>
      </View>
    </View>
  )
}
const styles = StyleSheet.create({
  fill: { flex: 1, minWidth: 0, minHeight: 0 },
  probe: { ...StyleSheet.absoluteFillObject, opacity: 0 },
})
