import { memo } from 'react'
import { View } from 'react-native'
import Text from '@/components/common/Text'
import { usePlayerMusicInfo } from '@/store/player/hook'
import { useTheme } from '@/store/theme/hook'
import { createStyle } from '@/utils/tools'

export default memo(() => {
  const musicInfo = usePlayerMusicInfo()
  const theme = useTheme()

  return (
    <View style={styles.container}>
      <Text numberOfLines={1} size={16} style={styles.title}>{musicInfo.name}</Text>
      <Text numberOfLines={1} size={12} color={theme['c-font-label']} style={styles.singer}>{musicInfo.singer}</Text>
    </View>
  )
})

const styles = createStyle({
  container: {
    paddingLeft: 10,
    paddingRight: 10,
    paddingTop: 2,
    paddingBottom: 4,
  },
  title: {
    fontWeight: '500',
  },
  singer: {
    paddingTop: 2,
  },
})
