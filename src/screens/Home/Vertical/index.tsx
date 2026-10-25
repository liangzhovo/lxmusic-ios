import Content from './Content'
import { Platform } from 'react-native'
import NavigationTabs from './NavigationTabs'
import PlayerBar from '@/components/player/PlayerBar'

export default () => {
  return (
    <>
      <Content />
      <PlayerBar isHome />
      {Platform.OS == 'ios' ? <NavigationTabs /> : null}
    </>
  )
}
