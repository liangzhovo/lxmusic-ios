export type LayoutSize = 'compact' | 'medium' | 'expanded'

export interface LayoutInfo {
  width: number
  height: number
  size: LayoutSize
  isLandscape: boolean
  isWide: boolean
}

export const getLayoutSize = (width: number): LayoutSize => {
  if (width >= 900) return 'expanded'
  if (width >= 600) return 'medium'
  return 'compact'
}

export const getLayoutInfo = (width: number, height: number): LayoutInfo => {
  const size = getLayoutSize(width)
  const isLandscape = width > height
  return {
    width,
    height,
    size,
    isLandscape,
    isWide: size != 'compact',
  }
}

// A narrow landscape window is still a phone-sized UI. No per-component
// hysteresis: Home, Player and popups must agree after every resize.
export const shouldUseIPadLayout = (width: number, height: number): boolean => (
  width >= 700 && height > 0 && width > height
)

export const shouldUseHorizontalLayout = (width: number, height: number): boolean => {
  if (!width || !height) return false

  // Preserve the existing phone-landscape behavior while also treating
  // squarer iPad/Stage Manager landscape windows as horizontal layouts.
  return width / height > 1.2 || (width > height && width >= 600)
}

export const getResponsiveRowInfo = (
  width: number,
  type: 'full' | 'medium' = 'full',
): { rowNum?: number, rowWidth: '50%' | '100%' } => {
  const minWidthForTwoColumns = type == 'medium' ? 960 : 720
  const isMultiRow = width >= minWidthForTwoColumns

  return {
    rowNum: isMultiRow ? 2 : undefined,
    rowWidth: isMultiRow ? '50%' : '100%',
  }
}
