import { compositeColor, contrastRatio } from './readability'
type Theme = { isDark?: boolean } & Partial<Record<'c-primary' | 'c-primary-font' | 'c-theme' | 'c-badge-secondary' | 'c-font' | 'c-font-label' | 'c-content-background' | 'c-main-background', string>>
type RGB = [number, number, number]
const rgb = (value: string): RGB => (value.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [0, 0, 0]) as RGB
const hsl = ([red, green, blue]: RGB) => {
  const r = red / 255, g = green / 255, b = blue / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, l = (max + min) / 2
  const s = d == 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  const h = d == 0 ? 0 : max == r ? ((g - b) / d + 6) % 6 : max == g ? (b - r) / d + 2 : (r - g) / d + 4
  return { h: h / 6, s, l }
}
const fromHSL = (h: number, s: number, l: number) => {
  const a = s * Math.min(l, 1 - l)
  const channel = (n: number) => {
    const k = (n + h * 12) % 12
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))))
  }
  return `rgb(${channel(0)}, ${channel(8)}, ${channel(4)})`
}
// Oklab (Bjorn Ottosson, public-domain matrices): unlike luminance contrast,
// this measures perceptual distance from the OTHER text on the same surface.
// https://bottosson.github.io/posts/oklab/
const oklab = (value: string, surface: string): RGB => {
  const [r, g, b] = rgb(compositeColor(value, surface)).map(v => {
    v /= 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s]
}
const distance = (a: RGB, b: RGB) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
const chroma = (a: RGB) => Math.hypot(a[1], a[2])
export const playingColorDistance = (a: string, b: string, surface: string) => distance(oklab(a, surface), oklab(b, surface))
export const playingColorChroma = (color: string, surface: string) => chroma(oklab(color, surface))
const cache = new Map<string, string>()
export const songSurface = (theme: Theme, surface?: string) => {
  const base = compositeColor(theme['c-content-background'] || 'transparent', theme.isDark ? '#121212' : '#ffffff')
  return compositeColor(surface || theme['c-main-background'] || base, base)
}
// Playback colour has three constraints: readable on the surface, visibly
// different from normal/secondary text, and moderate chroma (not near-grey or
// neon). A neutral theme MUST get a coloured accent, not brighter white/black.
export const playingColor = (theme: Theme, surface?: string): string => {
  const bg = songSurface(theme, surface)
  const dark = contrastRatio('#ffffff', bg) > contrastRatio('#000000', bg)
  const normal = theme['c-font'] || (dark ? '#dddddd' : '#333333')
  const secondary = theme['c-font-label'] || normal
  const accents = [theme['c-primary'], theme['c-primary-font'], theme['c-theme'], theme['c-badge-secondary']].filter(Boolean) as string[]
  const key = JSON.stringify([bg, normal, secondary, ...accents])
  const previous = cache.get(key)
  if (previous) return previous
  const accent = accents.map(c => hsl(rgb(compositeColor(c, bg)))).find(c => c.s >= 0.06)
  const backgroundHue = hsl(rgb(bg))
  // Neutral palettes have no hue to preserve. Use a subdued teal on dark
  // surfaces and a steel-blue on light ones; tinted neutral surfaces influence
  // the fallback. Coloured themes always try their own hue first.
  const hue = accent?.h ?? (backgroundHue.s > 0.12 ? (backgroundHue.h + 0.5) % 1 : dark ? 175 / 360 : 205 / 360)
  const texts = [oklab(normal, bg), oklab(secondary, bg)]
  let best = '', bestScore = Infinity, fallback = '', fallbackScore = -Infinity
  const evaluate = (h: number, hueCost: number) => {
    for (const saturation of [0.64, 0.72, 0.56, 0.48, 0.40]) for (let step = 18; step <= 82; step++) {
      const c = fromHSL((h + 1) % 1, saturation, step / 100)
      const lab = oklab(c, bg), strength = chroma(lab), contrast = contrastRatio(c, bg)
      if (strength < 0.085 || strength > 0.18) continue
      const separation = distance(lab, texts[0])
      const secondarySeparation = distance(lab, texts[1])
      const hueSeparation = Math.min(...texts.map(t => Math.hypot(lab[1] - t[1], lab[2] - t[2])))
      // Keep a chromatic best-effort result for pathological custom colours;
      // never silently fall back to the normal black/white text colour.
      const safeScore = Math.min(contrast, 4.8) * 3 + Math.min(separation, 0.16) * 10 + Math.min(hueSeparation, 0.07) * 10 - hueCost
      if (safeScore > fallbackScore) { fallbackScore = safeScore; fallback = c }
      if (contrast < 4.8 || separation < 0.16 || secondarySeparation < 0.10 || hueSeparation < 0.07) continue
      const score = Math.abs(contrast - 5.2) * 0.18 + Math.abs(strength - 0.12) * 14 + hueCost
      if (score < bestScore) { bestScore = score; best = c }
    }
  }
  evaluate(hue, 0)
  // Only move hue when the original would merge with another text colour or
  // cannot meet the surface constraints. Common built-in palettes stay put.
  if (!best) for (const offset of [1 / 12, -1 / 12, 1 / 6, -1 / 6, 1 / 3, -1 / 3, 0.5]) evaluate(hue + offset, Math.abs(offset))
  const result = best || fallback
  if (cache.size > 256) cache.clear()
  cache.set(key, result)
  return result
}
