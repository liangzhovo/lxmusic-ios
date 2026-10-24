import { memo } from 'react'
import { View } from 'react-native'
import StatusBar from '@/components/common/StatusBar'
import MoreBtn from './MoreBtn'

import Header from './components/Header'
import PageContent from '@/components/PageContent'

import Pic from './Pic'
import Lyric from './Lyric'
import Player from './Player'
import { createStyle } from '@/utils/tools'
import { useStatusbarHeight } from '@/store/common/hook'
import { horizontalLayout } from '../shared/layout'
import { usePlayDetailScreen } from '../shared/usePlayDetailScreen'

export default memo(({ componentId }: { componentId: string }) => {
  const statusBarHeight = useStatusbarHeight()
  usePlayDetailScreen(componentId)

  return (
    <PageContent>
      <StatusBar />
      <View style={{ ...styles.container, paddingTop: statusBarHeight }}>
        <View style={styles.left}>
          <Header />
          <View style={styles.leftContent}>
            <MoreBtn />
            <Pic componentId={componentId} />
          </View>
          <Player />
        </View>
        <View style={styles.right}>
          <Lyric />
        </View>
      </View>
    </PageContent>
  )
})

const styles = createStyle({
  container: {
    flex: 1,
    flexDirection: 'row',
    // 铺满屏幕（不设水平留白）
    paddingHorizontal: horizontalLayout.containerPaddingHorizontal,
  },
  left: {
    flex: 1,
    width: `${horizontalLayout.leftWidthRatio * 100}%`,
    // 左侧适度安全边距（不贴物理边缘，但不过分收窄）
    paddingLeft: horizontalLayout.leftPaddingLeft,
    // 底部留白：把进度条与时间顶离屏幕底边
    paddingBottom: horizontalLayout.leftPaddingBottom,
  },
  leftContent: {
    flexShrink: 1,
    flexGrow: 0,
    // 与 left.paddingLeft 对齐（保证与顶部图标同一条垂直线）
    marginLeft: 0,
  },
  right: {
    width: `${horizontalLayout.rightWidthRatio * 100}%`,
    flexGrow: 0,
    flexShrink: 0,
    // 歌词区最小安全边距（基本铺满到右缘）
    paddingRight: horizontalLayout.rightPaddingRight,
  },
  controlBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
})
