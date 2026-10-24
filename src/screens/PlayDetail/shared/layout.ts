/**
 * 播放详情页 - 布局 tokens（方向变体）
 * 横/竖屏布局差异全部集中在此，组件消费 tokens 而非魔法数字。
 * 调整排版（边距/宽度/对齐）只改这里，不动组件。
 */
export const horizontalLayout = {
  // 容器：铺满屏幕，不设水平留白
  containerPaddingHorizontal: 0,
  // 左侧统一参考线（返回键/功能图标/封面/进度条起点）
  leftPaddingLeft: 20,
  // 底部留白（进度条/时间顶离屏幕底边）
  leftPaddingBottom: 40,
  // 左（封面+控制）/ 右（歌词）宽度占比
  leftWidthRatio: 0.47,
  rightWidthRatio: 0.53,
  // 歌词区右缘最小安全边距
  rightPaddingRight: 10,
}

export type HorizontalLayoutTokens = typeof horizontalLayout
