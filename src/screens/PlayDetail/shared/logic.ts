/**
 * 播放详情页 - 纯逻辑（可单测，不依赖组件/store）
 */
import { setSpText } from '@/utils/pixelRatio'

/** 歌词行高（基于字号，1.3 倍行距） */
export const getLyricLineHeight = (lrcFontSize: number): number => setSpText(lrcFontSize / 10) * 1.3

/**
 * 计算滚动到指定歌词行的偏移量
 * 累积行高 + 目标行半行，再减去视口 42% 使目标行居中偏上
 */
export const getLyricScrollOffset = (
  lineHeights: number[],
  index: number,
  spaceHeight: number,
  viewportHeight: number,
): number => {
  let offset = spaceHeight
  for (let line = 0; line < index; line++) offset += lineHeights[line] ?? 0
  offset += (lineHeights[index] ?? 0) / 2
  return offset - viewportHeight * 0.42
}
