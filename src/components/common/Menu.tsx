import { playingColor } from '@/utils/playingColor'
import useSongKeyboard from '@/utils/hooks/useSongKeyboard'
import { overlaySurface, anchoredMenuBounds } from '@/utils/overlaySurface'
import { displayMenuLabel, menuMetrics } from '@/utils/menuLayout'
import { useImperativeHandle, forwardRef, useRef, useState, type Ref } from 'react'
import { View, ScrollView, TouchableHighlight, PixelRatio, Platform } from 'react-native'
import { useWindowSize } from '@/utils/hooks'
import Modal, { type ModalType } from './Modal'
import { useTheme } from '@/store/theme/hook'
import Text from './Text'
import { setSpText } from '@/utils/pixelRatio'

export interface Position { w: number, h: number, x: number, y: number, menuWidth?: number, menuHeight?: number }
export interface MenuSize { width?: number, height?: number }
export type Menus = Readonly<Array<{ action: string, label: string, disabled?: boolean }>>
export interface MenuProps<M extends Menus = Menus> {
  menus: M
  onPress: (menu: M[number]) => void
  onHide?: () => void
  width?: number
  height?: number
  fontSize?: number
  center?: boolean
  activeId?: M[number]['action'] | null
}
export interface MenuType {
  show: (position: Position, menuSize?: MenuSize) => void
  hide: () => void
}

const Menu = ({ buttonPosition, menuSize, menus, width, height, onPress, onHide, activeId, fontSize = 15, center = false }:
  MenuProps & { buttonPosition: Position, menuSize: MenuSize, onHide: () => void }) => {
  const baseTheme = useTheme()
  // A popup has its own surface; page contrast is not sufficient here.
  const theme = Platform.OS == 'ios'
    ? { ...baseTheme, 'c-primary-font': playingColor(baseTheme, overlaySurface(baseTheme).backgroundColor as string) }
    : baseTheme
  const window = useWindowSize()
  const viewportRef = useRef<View>(null)
  const scrollRef = useRef<ScrollView>(null)
  const itemOffsets = useRef<Record<string, number>>({})
  const [viewport, setViewport] = useState({ x: 0, y: 0, width: window.width, height: window.height })
  const [measuredWidth, setMeasuredWidth] = useState(0)
  const [contentHeight, setContentHeight] = useState(0)
  const metrics = menuMetrics(menus.map(menu => menu.label), setSpText(fontSize) * PixelRatio.getFontScale(),
    Math.max(width ?? 0, menuSize.width ?? 0, measuredWidth + 36), height ?? 44)
  const menuStyle = anchoredMenuBounds(viewport.width, viewport.height, buttonPosition,
    metrics.width, contentHeight || menus.length * metrics.rowHeight + 8, viewport)
  const press = (menu: Menus[number]) => {
    onHide()
    setTimeout(() => onPress(menu), 260)
  }
  const focused = useSongKeyboard(menus.filter(menu => !menu.disabled).map(menu => ({ ...menu, id: menu.action })),
    menu => { if (menu.action != activeId) press(menu) }, index => {
      const item = menus.filter(menu => !menu.disabled)[index]
      if (item) scrollRef.current?.scrollTo({ y: Math.max(0, (itemOffsets.current[item.action] ?? 0) - menuStyle.height / 3), animated: false })
    })
  return <View ref={viewportRef} style={{ flex: 1 }} pointerEvents="box-none" onLayout={() => {
    viewportRef.current?.measureInWindow((x, y, width, height) => {
      if (width <= 0 || height <= 0) return
      setViewport(previous => previous.x == x && previous.y == y && previous.width == width && previous.height == height
        ? previous : { x, y, width, height })
    })
  }}>
    {/* Native glyph measurement supplements the conservative initial width. */}
    <View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
      style={{ position: 'absolute', width: 4096, opacity: 0 }}>
      {menus.map(menu => <Text key={menu.action} size={fontSize} onTextLayout={event => {
        const width = Math.max(0, ...event.nativeEvent.lines.map(line => line.width))
        setMeasuredWidth(previous => Math.max(previous, width))
      }}>{displayMenuLabel(menu.label)}</Text>)}
    </View>
    <View testID="operation-menu-surface" style={{ position: 'absolute', ...menuStyle, ...overlaySurface(theme) }}
      onStartShouldSetResponder={() => true}>
      <ScrollView ref={scrollRef} style={{ borderRadius: 11, overflow: 'hidden' }} contentContainerStyle={{ paddingVertical: 4 }}
        keyboardShouldPersistTaps="always" onContentSizeChange={(_width, height) => setContentHeight(height)}>
        {menus.map(menu => <TouchableHighlight key={menu.action} onLayout={event => { itemOffsets.current[menu.action] = event.nativeEvent.layout.y }} accessibilityRole="menuitem"
          accessibilityLabel={displayMenuLabel(menu.label)} accessibilityState={{ disabled: !!menu.disabled, selected: menu.action == activeId }}
          disabled={menu.disabled || menu.action == activeId}
          style={{ minHeight: metrics.rowHeight, paddingHorizontal: 16, paddingVertical: 10,
            justifyContent: 'center', opacity: menu.disabled ? 0.45 : 1, backgroundColor: 'transparent' }}
          underlayColor={theme['c-primary-background-active']} onPress={() => press(menu)}>
          <View>
          {menu.action == focused ? <View pointerEvents="none" style={{ position: 'absolute', left: -8, right: -8, top: -5, bottom: -5, borderWidth: 1, borderColor: theme['c-primary-font'] }} /> : null}
          <Text size={fontSize} style={{ textAlign: center ? 'center' : 'left', flexShrink: 1 }}
            color={menu.action == activeId || menu.action == focused ? theme['c-primary-font'] : theme['c-font']}>{displayMenuLabel(menu.label)}</Text>
          </View>
        </TouchableHighlight>)}
      </ScrollView>
    </View>
  </View>
}

const Component = <M extends Menus>({ onHide, ...props }: MenuProps<M>, ref: Ref<MenuType>) => {
  const modalRef = useRef<ModalType>(null)
  const [position, setPosition] = useState<Position>({ w: 0, h: 0, x: 0, y: 0 })
  const [size, setSize] = useState<MenuSize>({})
  const [generation, setGeneration] = useState(0)
  const hide = () => modalRef.current?.setVisible(false)
  useImperativeHandle(ref, () => ({
    show(position, menuSize) {
      setPosition(position)
      setSize(menuSize ?? {})
      setGeneration(value => value + 1)
      modalRef.current?.setVisible(true)
    }, hide,
  }))
  return <Modal onHide={onHide} ref={modalRef} bgColor="transparent">
    <Menu key={generation} {...props} buttonPosition={position} menuSize={size} onHide={hide} />
  </Modal>
}
export default forwardRef(Component) as <M extends Menus>(p: MenuProps<M> & { ref?: Ref<MenuType> }) => JSX.Element | null
