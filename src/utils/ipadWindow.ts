import { Dimensions, Platform } from 'react-native'

const IPAD_WINDOW_SIZE_TOLERANCE = 24

export const isIPadWindowed = (width: number, height: number): boolean => {
  if (Platform.OS != 'ios' || !Platform.isPad || !width || !height) return false
  const screen = Dimensions.get('screen')
  const windowLongEdge = Math.max(width, height)
  const windowShortEdge = Math.min(width, height)
  const screenLongEdge = Math.max(screen.width, screen.height)
  const screenShortEdge = Math.min(screen.width, screen.height)
  return windowLongEdge < screenLongEdge - IPAD_WINDOW_SIZE_TOLERANCE ||
    windowShortEdge < screenShortEdge - IPAD_WINDOW_SIZE_TOLERANCE
}

// Compatibility API for older headers. The shared WindowContent now reserves
// vertical space, so never add the former 88-point horizontal exclusion zone.
export const getIPadWindowControlsLeadingInset = (_width: number, _height: number): number => 0
