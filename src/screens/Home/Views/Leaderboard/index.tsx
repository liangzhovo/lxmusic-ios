import { KeyboardPage } from '@/components/KeyboardScope'
import { useHorizontalMode } from '@/utils/hooks'
import Vertical from './Vertical'
import Horizontal from './Horizontal'
// import { AppColors } from '@/theme'

const Page = () => {
  const isHorizontalMode = useHorizontalMode()

  return isHorizontalMode
    ? <Horizontal />
    : <Vertical />
}

export default () => <KeyboardPage navId="nav_top"><Page /></KeyboardPage>
