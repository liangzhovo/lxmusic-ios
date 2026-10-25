import { OVERLAY_BACKDROP, overlaySurface } from '@/utils/overlaySurface'
import { useImperativeHandle, forwardRef, useRef, useState } from 'react'
import { View, TouchableOpacity, useWindowDimensions } from 'react-native'
import Popup from './Popup'
import Modal, { type ModalType } from './Modal'
import { Icon } from './Icon'
import { useKeyboard } from '@/utils/hooks'
import { useTheme } from '@/store/theme/hook'
import Text from './Text'

export interface DialogProps {
  position?: 'center' | 'left'
  onHide?: () => void
  keyHide?: boolean
  bgHide?: boolean
  closeBtn?: boolean
  title?: string
  children: React.ReactNode
  height?: number | `${number}%`
  maxWidth?: number
}
export interface DialogType { setVisible: (visible: boolean) => void }
export default forwardRef<DialogType, DialogProps>(({
  onHide, keyHide = true, bgHide = true, closeBtn = true, title = '', position = 'center', children, height, maxWidth = 560,
}, ref) => {
  const theme = useTheme()
  const window = useWindowDimensions()
  const { keyboardShown, keyboardHeight } = useKeyboard()
  const [frame, setFrame] = useState({ width: 0, height: 0 })
  const modalRef = useRef<ModalType>(null)
  useImperativeHandle(ref, () => ({ setVisible(visible: boolean) { modalRef.current?.setVisible(visible) } }))
  if (position == 'left') return <Popup ref={modalRef} onHide={onHide} keyHide={keyHide} bgHide={bgHide} closeBtn={closeBtn} title={title} kind="list" position="left">{children}</Popup>
  const availableWidth = frame.width || window.width
  const availableHeight = frame.height || Math.max(0, window.height - 80 - (keyboardShown ? keyboardHeight : 0))
  return <Modal ref={modalRef} onHide={onHide} keyHide={keyHide} bgHide={bgHide} bgColor={OVERLAY_BACKDROP}>
    <View style={{ flex: 1, paddingBottom: keyboardShown ? keyboardHeight : 0 }}>
      <View onLayout={e => setFrame(e.nativeEvent.layout)} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 0 }}>
        <View onStartShouldSetResponder={() => true} style={{ width: Math.max(0, Math.min(maxWidth, availableWidth - 24)),
          maxHeight: Math.max(0, availableHeight - 24), height, flexShrink: 1, ...overlaySurface(theme) }}>
          <View style={{ minHeight: 44, flexShrink: 0, justifyContent: 'center', borderTopWidth: 3, borderTopColor: theme['c-primary-font'] }}>
            <Text size={15} style={{ paddingLeft: 16, paddingRight: 50, fontWeight: '600' }}>{title}</Text>
            {closeBtn ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="关闭" onPress={() => modalRef.current?.setVisible(false)}
              style={{ position: 'absolute', right: 0, top: 0, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="close" rawSize={16} color={theme['c-font']} />
            </TouchableOpacity> : null}
          </View>
          {children}
        </View>
      </View>
    </View>
  </Modal>
})
