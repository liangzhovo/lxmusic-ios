// Reserve enough room for complete localized labels before the native text
// measurement arrives. Labels may wrap at very small widths; never ellipsize.
export const displayMenuLabel = (label: string) => label
  .replace(/^添加到(?:\.{3}|…)$/, '添加到列表')
  .replace(/^移动到(?:\.{3}|…)$/, '移动到列表')
export const estimateLabelWidth = (label: string, fontSize: number) => (
  Array.from(label).reduce((width, char) => width + (char.charCodeAt(0) > 255 ? 1.05 : 0.72) * fontSize, 0)
)
export const menuMetrics = (labels: readonly string[], fontSize: number, requestedWidth = 0, minimumRow = 44) => ({
  width: Math.max(176, requestedWidth, ...labels.map(label => estimateLabelWidth(displayMenuLabel(label), fontSize) + 36)),
  rowHeight: Math.max(44, minimumRow, Math.ceil(fontSize * 1.4 + 20)),
})
