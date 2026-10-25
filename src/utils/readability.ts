// Window-independent text sizing and semantic foreground contrast.
export const readableTextSize = (size: number) => size <= 0 ? size : Math.max(13, size + 2)
type RGB = [number, number, number]
const parse = (color: string, fallback: RGB): RGB => {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(color)
  if (hex) {
    const h = hex[1].length <= 4 ? hex[1].split('').map(c => c + c).join('') : hex[1]
    const alpha = h.length == 8 ? parseInt(h.slice(6), 16) / 255 : 1
    return [0, 2, 4].map((i, n) => Math.round(parseInt(h.slice(i, i + 2), 16) * alpha + fallback[n] * (1 - alpha))) as RGB
  }
  const rgb = /^rgba?\(\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\s*\)$/.exec(color)
  if (!rgb) return fallback
  const alpha = rgb[4] == null ? 1 : Math.min(1, Math.max(0, Number(rgb[4])))
  return [1, 2, 3].map((i, n) => Math.round(Number(rgb[i]) * alpha + fallback[n] * (1 - alpha))) as RGB
}
const luminance = (rgb: RGB) => rgb.map(v => {
  v /= 255
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0)
export const compositeColor = (foreground: string, background: string) => `rgb(${parse(foreground, parse(background, [255, 255, 255])).join(', ')})`
export const contrastRatio = (foreground: string, background: string) => {
  const bg = parse(background, [255, 255, 255])
  const a = luminance(parse(foreground, bg)); const b = luminance(bg)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}
export const readableColor = (foreground: string, background: string, minimum = 4.5) => {
  const bg = parse(background, [255, 255, 255])
  const fg = parse(foreground, bg)
  const target = luminance(bg) > 0.179 ? 0 : 255
  for (let step = 0; step <= 100; step++) {
    const result = `rgb(${fg.map(v => Math.round(v + (target - v) * step / 100)).join(', ')})`
    if (contrastRatio(result, background) >= minimum) return result
  }
  return target == 0 ? '#000000' : '#ffffff'
}
export const readableTheme = <T extends { 'c-content-background': string, 'c-font': string, 'c-font-label': string, 'c-primary-font': string, 'c-button-font': string, 'c-button-background': string }>(theme: T): T => {
  const bg = theme['c-content-background']
  return {
    ...theme,
    'c-font': readableColor(theme['c-font'], bg, 7),
    'c-font-label': readableColor(theme['c-font-label'], bg, 5),
    'c-primary-font': readableColor(theme['c-primary-font'], bg, 4.5),
    'c-primary-font-active': readableColor(theme['c-primary-font'], bg, 5),
    'c-primary-font-hover': readableColor(theme['c-primary-font'], bg, 5),
    'c-button-font': readableColor(theme['c-button-font'], compositeColor(theme['c-button-background'], bg), 5),
  }
}
