import { Dimensions, Platform, StatusBar } from 'react-native'
import { getWindowSize as getWindowSizeRaw } from './nativeModules/utils'

export type SizeHandler = (size: { width: number, height: number }) => void
export const getWindowSize = async() => {
  if (Platform.OS == 'ios') {
    const { width, height } = Dimensions.get('window')
    return { width, height }
  }
  const size = await getWindowSizeRaw()
  const scale = Dimensions.get('window').scale
  return { width: size.width / scale, height: size.height / scale }
}
let initialized = false
const initial = Dimensions.get('window')
export const windowSizeTools = {
  size: { width: initial.width, height: initial.height },
  listeners: [] as SizeHandler[],
  getSize() { return this.size },
  onSizeChanged(handler: SizeHandler) {
    this.listeners.push(handler)
    return () => {
      const index = this.listeners.indexOf(handler)
      if (index >= 0) this.listeners.splice(index, 1)
    }
  },
  async init() {
    if (!initialized) {
      initialized = true
      Dimensions.addEventListener('change', ({ window }) => {
        this.setWindowSize(window.width, window.height)
      })
    }
    // iOS dimensions are already logical points and update synchronously.
    // Do not allow an old native query to overwrite a newer layout event.
    if (Platform.OS == 'ios') {
      const { width, height } = Dimensions.get('window')
      this.setWindowSize(width, height)
    } else {
      const size = await getWindowSize()
      const fallback = Dimensions.get('window')
      this.setWindowSize(size.width || fallback.width, size.height || fallback.height + (StatusBar.currentHeight ?? 0))
    }
    return this.size
  },
  setWindowSize(width: number, height: number) {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return
    width = Math.round(width); height = Math.round(height)
    if (this.size.width == width && this.size.height == height) return
    this.size = { width, height }
    for (const handler of [...this.listeners]) handler(this.size)
  },
}
