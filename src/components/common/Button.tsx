import { useTheme } from '@/store/theme/hook'
import { useMemo, useRef, useImperativeHandle, forwardRef } from 'react'
import { Pressable, type PressableProps, StyleSheet, type View, type ViewProps, type GestureResponderEvent } from 'react-native'
import { hapticLight } from '@/utils/nativeModules/utils'
// import { AppColors } from '@/theme'


export interface BtnProps extends PressableProps {
  ripple?: PressableProps['android_ripple']
  style?: ViewProps['style']
  onChangeText?: (value: string) => void
  onClearText?: () => void
  children: React.ReactNode
}


export interface BtnType {
  measure: (callback: (x: number, y: number, width: number, height: number, pageX: number, pageY: number) => void) => void
}

export default forwardRef<BtnType, BtnProps>(({ ripple: propsRipple = {}, disabled, children, style, onPress, ...props }, ref) => {
  const theme = useTheme()
  const btnRef = useRef<View>(null)
  const ripple = useMemo(() => ({
    color: theme['c-primary-light-200-alpha-700'],
    ...propsRipple,
  }), [theme, propsRipple])

  useImperativeHandle(ref, () => ({
    measure(callback) {
      btnRef.current?.measure(callback)
    },
  }))

  // 成功触发按键时轻微震动（disabled 时 Pressable 不会回调 onPress，天然符合"成功触发"）
  const handlePress = (event: GestureResponderEvent) => {
    hapticLight()
    onPress?.(event)
  }

  return (
    <Pressable
      android_ripple={ripple}
      disabled={disabled}
      style={StyleSheet.compose({ opacity: disabled ? 0.3 : 1 }, style)}
      onPress={handlePress}
      {...props}
      ref={btnRef}
    >
      {children}
    </Pressable>
  )
})

