import { type ReactNode } from 'react'
import { TouchableOpacity, View, StyleSheet } from 'react-native'
import { Icon } from '@/components/common/Icon'
import { useTheme } from '@/store/theme/hook'

export const BTN_WIDTH = 44
export const BTN_ICON_SIZE = 18
export default ({ icon, size = BTN_ICON_SIZE, color, onPress, onLongPress, label, children }: {
  icon?: string
  size?: number
  color?: string
  label?: string
  children?: ReactNode
  onPress: () => void
  onLongPress?: () => void
}) => {
  const theme = useTheme()
  return (
    <TouchableOpacity style={styles.button} activeOpacity={0.5} accessibilityRole="button" accessibilityLabel={label}
      onPress={onPress} onLongPress={onLongPress}>
      <View pointerEvents="none" style={styles.glyph}>
        {children ?? <Icon name={icon!} color={color ?? theme['c-font-label']} rawSize={size}
          style={{ lineHeight: size, textAlign: 'center', includeFontPadding: false }} />}
      </View>
    </TouchableOpacity>
  )
}
const styles = StyleSheet.create({
  button: { width: BTN_WIDTH, height: BTN_WIDTH, alignItems: 'center', justifyContent: 'center' },
  glyph: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
})
