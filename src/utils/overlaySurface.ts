import type { ViewStyle } from 'react-native'
import { compositeColor } from './readability'

export const OVERLAY_BACKDROP = 'transparent'
// A distinct opaque surface, visible border and an iOS shadow (elevation alone
// is Android-only). Keep the source palette rather than hard-coding white.
export const overlaySurface = (theme: { isDark: boolean, 'c-content-background': string }): ViewStyle => ({
  backgroundColor: compositeColor(theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(20,40,65,0.045)', theme['c-content-background']),
  borderWidth: 1,
  borderColor: theme.isDark ? 'rgba(255,255,255,0.24)' : 'rgba(30,50,75,0.22)',
  borderRadius: 12,
  shadowColor: '#000000',
  shadowOpacity: theme.isDark ? 0.65 : 0.28,
  shadowOffset: { width: 0, height: 5 },
  shadowRadius: 16,
  elevation: 10,
})

export const anchoredMenuBounds = (width: number, height: number,
  anchor: { x: number, y: number, w: number, h: number }, requestedWidth: number, requestedHeight: number,
  origin = { x: 0, y: 0 }) => {
  const margin = Math.max(0, Math.min(8, width / 2, height / 2))
  const w = Math.max(0, Math.min(requestedWidth, width - margin * 2))
  const x = anchor.x - origin.x
  const y = anchor.y - origin.y
  const above = Math.max(0, y - margin * 2)
  const below = Math.max(0, height - y - anchor.h - margin * 2)
  const useBelow = below >= requestedHeight || below >= above
  const h = Math.max(0, Math.min(requestedHeight, Math.max(above, below), height - margin * 2))
  return { width: w, height: h,
    left: Math.max(margin, Math.min(x, width - margin - w)),
    top: Math.max(margin, Math.min(useBelow ? y + anchor.h + margin : y - h - margin, height - margin - h)),
  }
}
