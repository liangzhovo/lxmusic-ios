/**
 * 播放详情页 - 共享按钮（横/竖屏通用）
 * 横屏：方形按钮（宽高 = HEADER_HEIGHT 缩放宽），支持长按；
 * 竖屏：宽度 = HEADER_HEIGHT 缩放高，高度随容器（100%）。
 */
import { TouchableOpacity } from 'react-native'
import { Icon } from '@/components/common/Icon'
import { createStyle } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import { scaleSizeW, scaleSizeH } from '@/utils/pixelRatio'
import { HEADER_HEIGHT as _HEADER_HEIGHT } from '@/config/constant'

export const BTN_WIDTH = scaleSizeW(_HEADER_HEIGHT)
export const BTN_HEIGHT_VERTICAL = scaleSizeH(_HEADER_HEIGHT)
export const BTN_ICON_SIZE_HORIZONTAL = 20

export default ({ icon, size, color, onPress, onLongPress, variant = 'horizontal' }: {
  icon: string
  size?: number
  color?: string
  onPress: () => void
  onLongPress?: () => void
  variant?: 'horizontal' | 'vertical'
}) => {
  const theme = useTheme()
  if (variant == 'vertical') {
    return (
      <TouchableOpacity onPress={onPress} style={{ ...styles.verticalButton, width: BTN_HEIGHT_VERTICAL }}>
        <Icon name={icon} color={color} size={size ?? 18} />
      </TouchableOpacity>
    )
  }
  return (
    <TouchableOpacity style={{ ...styles.cotrolBtn, width: BTN_WIDTH, height: BTN_WIDTH }} activeOpacity={0.5} onPress={onPress} onLongPress={onLongPress}>
      <Icon name={icon} color={color ?? theme['c-550']} size={size ?? BTN_ICON_SIZE_HORIZONTAL} />
    </TouchableOpacity>
  )
}

const styles = createStyle({
  cotrolBtn: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  verticalButton: {
    justifyContent: 'center',
    alignItems: 'center',
    height: '100%',
    flex: 0,
  },
})
