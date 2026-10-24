/**
 * 播放详情页 - 共享"评论"按钮（横/竖屏通用，方向差异由 variant 控制）
 */
import Btn from './Btn'
import { navigations } from '@/navigation'
import commonState from '@/store/common/state'

export default ({ variant = 'horizontal' }: { variant?: 'horizontal' | 'vertical' }) => {
  const handleShowCommentScreen = () => {
    navigations.pushCommentScreen(commonState.componentIds.playDetail!)
  }

  return <Btn icon="comment" onPress={handleShowCommentScreen} variant={variant} />
}
