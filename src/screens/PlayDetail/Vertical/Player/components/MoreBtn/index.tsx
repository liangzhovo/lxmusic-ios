import { Platform } from 'react-native'
import PlaylistBtn from '@/screens/PlayDetail/Horizontal/components/PlaylistBtn'
import { createStyle } from '@/utils/tools'
import { View } from 'react-native'
import PlayModeBtn from './PlayModeBtn'
import MusicAddBtn from './MusicAddBtn'
import DesktopLyricBtn from './DesktopLyricBtn'
import CommentBtn from './CommentBtn'

export default () => {
  return (
    <View style={styles.container}>
      {Platform.OS == 'ios' ? <PlaylistBtn /> : <DesktopLyricBtn />}
      <MusicAddBtn />
      <PlayModeBtn />
      <CommentBtn />
    </View>
  )
}


const styles = createStyle({
  container: {
    // flexShrink: 0,
    // flexGrow: 0,
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    // backgroundColor: 'rgba(0,0,0,0.1)',
  },
})
