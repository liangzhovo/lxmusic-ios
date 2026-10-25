/**
 * Created by qianxin on 17/6/1.
 * 屏幕工具类
 * ui设计基准,iphone 6
 * width:375
 * height:667
 */
import { readableTextSize } from './readability'
import { Dimensions, PixelRatio, Platform } from 'react-native'
import { windowSizeTools } from './windowSizeTools'

const designWidth = 375.0
const designHeight = 667.0

const getMetrics = () => {
  const storedSize = windowSizeTools.getSize()
  const fallbackSize = Dimensions.get('window')

  let screenW = storedSize.width || fallbackSize.width
  let screenH = storedSize.height || fallbackSize.height

  // Keep the original portrait-based sizing behavior so existing iPhone UI
  // remains stable, but recalculate it whenever the active window changes.
  if (screenW > screenH) {
    const temp = screenW
    screenW = screenH
    screenH = temp
  }

  const fontScale = PixelRatio.getFontScale()
  const pixelRatio = PixelRatio.get()
  const screenPxW = PixelRatio.getPixelSizeForLayoutSize(screenW)
  const screenPxH = PixelRatio.getPixelSizeForLayoutSize(screenH)
  const scaleW = screenPxW / designWidth
  const scaleH = screenPxH / designHeight
  const scale = Math.min(scaleW, scaleH, 3.1)

  return {
    screenW,
    screenH,
    fontScale,
    pixelRatio,
    scale,
  }
}

/**
 * 设置text
 * @param size px
 * @returns dp
 */
export function getTextSize(size: number) {
  if (Platform.OS == 'ios') return readableTextSize(size)
  const { screenW, screenH, fontScale } = getMetrics()
  const scaleWidth = screenW / designWidth
  const scaleHeight = screenH / designHeight
  const scale = Math.min(scaleWidth, scaleHeight, 1.3)
  return Math.floor(size * scale / fontScale)
}

export function setSpText(size: number) {
  return getTextSize(size) * global.lx.fontSize
}

/**
 * 设置高度
 * @param size px
 * @returns dp
 */
export function scaleSizeH(size: number) {
  if (Platform.OS == 'ios') return size * global.lx.fontSize
  const { scale, pixelRatio } = getMetrics()
  const scaleHeight = size * scale
  size = Math.floor(scaleHeight / pixelRatio)
  return size * global.lx.fontSize
}

/**
 * 设置宽度
 * @param size px
 * @returns dp
 */
export function scaleSizeW(size: number) {
  if (Platform.OS == 'ios') return size * global.lx.fontSize
  const { scale, pixelRatio } = getMetrics()
  const scaleWidth = size * scale
  size = Math.floor(scaleWidth / pixelRatio)
  return size * global.lx.fontSize
}

export const scaleSizeWR = (size: number) => {
  return size * 2 - scaleSizeW(size)
}

export const scaleSizeHR = (size: number) => {
  return size * 2 - scaleSizeH(size)
}

export const scaleSizeAbsHR = (size: number) => {
  if (Platform.OS == 'ios') return size
  const { scale, pixelRatio } = getMetrics()
  const scaleHeight = size * scale
  return size * 2 - Math.floor(scaleHeight / pixelRatio)
}
