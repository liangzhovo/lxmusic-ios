import { useMemo } from 'react'
import { getLayoutInfo } from '@/utils/layout'
import useWindowSize from './useWindowSize'

export default () => {
  const { width, height } = useWindowSize()

  return useMemo(() => getLayoutInfo(width, height), [width, height])
}
