import { readableTheme } from './readability'
import { playingColor } from './playingColor'

type ReadableTheme = Parameters<typeof readableTheme>[0]

// Surface contrast alone can turn an active label into the same black/white as
// ordinary text. Share the chromatic, hue-preserving foreground policy across
// navigation, list names and menu selections, not only the currently playing row.
// Keep the raw theme seed, body text, backgrounds and upstream geometry intact.
export const readableThemeWithAccent = <T extends ReadableTheme>(theme: T): T => {
  const readable = readableTheme(theme)
  const accent = playingColor(readable)
  return {
    ...readable,
    'c-primary-font': accent,
    'c-primary-font-hover': accent,
    'c-primary-font-active': accent,
  }
}
