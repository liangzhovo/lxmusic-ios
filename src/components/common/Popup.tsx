import { OVERLAY_BACKDROP, overlaySurface } from '@/utils/overlaySurface'
import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { View, Animated, TouchableOpacity, Platform, useWindowDimensions } from 'react-native'
import Modal, { type ModalType } from './Modal'
import { Icon } from './Icon'
import { useKeyboard } from '@/utils/hooks'
import { useTheme } from '@/store/theme/hook'
import Text from './Text'
import { panelBounds, panelPosition, type PanelKind, type PanelPosition } from '@/utils/panelLayout'

export interface PopupProps {
  onHide?: () => void
  keyHide?: boolean
  bgHide?: boolean
  closeBtn?: boolean
  position?: PanelPosition
  kind?: PanelKind
  title?: string
  children: React.ReactNode
}
export interface PopupType { setVisible: (visible: boolean) => void }

export default forwardRef<PopupType, PopupProps>(({
  onHide, keyHide = true, bgHide = true, closeBtn = true,
  position = 'bottom', kind = 'panel', title = '', children,
}, ref) => {
  const theme = useTheme()
  const { keyboardShown, keyboardHeight } = useKeyboard()
  const window = useWindowDimensions()
  const [frame, setFrame] = useState({ width: 0, height: 0 })
  const modalRef = useRef<ModalType>(null)
  const entrance = useRef(new Animated.Value(1)).current
  // Preserve each caller's placement; only the player queue opts into left.
  const actualPosition = panelPosition(Platform.OS == 'ios', kind, position)
  const bounds = panelBounds(frame.width || window.width, frame.height || Math.max(0, window.height - 80 - (keyboardShown ? keyboardHeight : 0)), kind)
  useImperativeHandle(ref, () => ({
    setVisible(visible: boolean) {
      entrance.stopAnimation()
      entrance.setValue(visible && actualPosition == 'left' ? 0 : 1)
      modalRef.current?.setVisible(visible)
    },
  }))
  const side = actualPosition == 'left' || actualPosition == 'right'
  return <Modal ref={modalRef} onHide={onHide} keyHide={keyHide} bgHide={bgHide} bgColor={OVERLAY_BACKDROP}
    animationType={actualPosition == 'left' ? 'none' : 'fade'} onShow={() => {
      if (actualPosition == 'left') Animated.timing(entrance, { toValue: 1, duration: 220, useNativeDriver: true }).start()
    }}>
    <View style={{ flex: 1, paddingBottom: keyboardShown ? keyboardHeight : 0 }}>
      <View onLayout={e => setFrame(e.nativeEvent.layout)} style={{ flex: 1, minHeight: 0, paddingHorizontal: 12,
        alignItems: side ? actualPosition == 'left' ? 'flex-start' : 'flex-end' : 'center',
        justifyContent: actualPosition == 'top' ? 'flex-start' : actualPosition == 'bottom' ? 'flex-end' : 'center' }}>
        <Animated.View onStartShouldSetResponder={() => true} style={{ width: bounds.width, height: bounds.height, minHeight: 0,
          ...overlaySurface(theme),
          transform: actualPosition == 'left' ? [{ translateX: entrance.interpolate({ inputRange: [0, 1], outputRange: [-bounds.width - 12, 0] }) }] : undefined }}>
          <View style={{ minHeight: 48, flexShrink: 0, justifyContent: 'center', borderBottomWidth: .5, borderBottomColor: theme['c-border-background'] }}>
            <Text size={15} style={{ paddingLeft: 16, paddingRight: 52, fontWeight: '600' }}>{title}</Text>
            {closeBtn ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="关闭" onPress={() => modalRef.current?.setVisible(false)}
              style={{ position: 'absolute', right: 0, top: 2, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="close" rawSize={16} color={theme['c-font']} />
            </TouchableOpacity> : null}
          </View>
          <View style={{ flex: 1, minHeight: 0 }}>{children}</View>
        </Animated.View>
      </View>
    </View>
  </Modal>
})
