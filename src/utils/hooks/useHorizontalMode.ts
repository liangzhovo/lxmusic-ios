import { Platform } from 'react-native'
import useWindowSize from './useWindowSize'
import { shouldUseHorizontalLayout, shouldUseIPadLayout } from '../layout'

export default () => {
  const { width, height } = useWindowSize()
  return Platform.OS == 'ios' && Platform.isPad
    ? shouldUseIPadLayout(width, height)
    : shouldUseHorizontalLayout(width, height)
}
