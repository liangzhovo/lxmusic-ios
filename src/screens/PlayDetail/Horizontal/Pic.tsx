import { memo, useEffect, useState } from 'react'
import { View, type LayoutChangeEvent } from 'react-native'
import { usePlayerMusicInfo } from '@/store/player/hook'
import { useNavigationComponentDidAppear } from '@/navigation'
import { NAV_SHEAR_NATIVE_IDS } from '@/config/constant'
import { createStyle } from '@/utils/tools'
import PlayerCover from '@/components/player/PlayerCover'
import commonState from '@/store/common/state'

export default memo(({ componentId }: { componentId: string }) => {
  const musicInfo = usePlayerMusicInfo()
  const [animated, setAnimated] = useState(!!commonState.componentIds.playDetail)
  const [pic, setPic] = useState(musicInfo.pic)
  const [size, setSize] = useState(0)
  useEffect(() => { if (animated) setPic(musicInfo.pic) }, [musicInfo.pic, animated])
  useNavigationComponentDidAppear(componentId, () => { setAnimated(true) })

  const handleLayout = ({ nativeEvent }: LayoutChangeEvent) => {
    const { width, height } = nativeEvent.layout
    // Fit the actual remaining body space after title and dock have laid out.
    // Window-size formulas caused clipping in shorter floating windows.
    const next = Math.max(0, Math.min(width - 20, height - 12, 420))
    setSize(previous => Math.abs(previous - next) < 0.5 ? previous : next)
  }

  return (
    <View style={styles.container} onLayout={handleLayout}>
      <View style={{ elevation: animated ? 3 : 0, borderRadius: 4 }}>
        <PlayerCover url={pic} componentId={componentId} nativeID={NAV_SHEAR_NATIVE_IDS.playDetail_pic} size={size} />
      </View>
    </View>
  )
})

const styles = createStyle({
  container: { flex: 1, minHeight: 0, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
})
