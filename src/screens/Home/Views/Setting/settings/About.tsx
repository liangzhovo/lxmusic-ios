import { memo } from 'react'
import { View, TouchableOpacity, Alert } from 'react-native'
import Clipboard from '@react-native-clipboard/clipboard'
import Section from '../components/Section'
import { openUrl, toast } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import Text from '@/components/common/Text'
import { showPactModal } from '@/core/common'
import { PORT_PROJECT } from '@/config/project'

const visit = (url: string) => { void openUrl(url).catch(() => { toast('无法打开链接，请检查网络或浏览器设置') }) }
export default memo(() => {
  const theme = useTheme()
  const feedback = async() => {
    const report = `LX Music iOS/iPadOS ${process.versions.app}\n问题描述：\n复现步骤：\n设备/系统：\n期望结果：\n实际结果：\n（请勿附音源密钥、配对码或隐私数据）`
    Clipboard.setString(report)
    // A fork may have Issues disabled. Never silently send its users upstream.
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 6000)
    try {
      const response = await fetch('https://api.github.com/repos/skyhc/lx-music-mobile', { signal: controller.signal })
      if (response.ok && (await response.json()).has_issues === false) {
        Alert.alert('问题反馈', '反馈内容已复制。移植仓库暂未开启 Issues，请维护者在仓库设置中启用；本移植版问题不要提交到上游官方仓库。', [
          { text: '关闭', style: 'cancel' }, { text: '打开移植仓库', onPress: () => visit(PORT_PROJECT.repository) },
        ])
        return
      }
    } catch {} finally { clearTimeout(timer) }
    visit(PORT_PROJECT.issues + '/new/choose')
  }
  const link = (label: string, url: string) => <TouchableOpacity accessibilityRole="link" onPress={() => visit(url)} style={{ paddingVertical: 10 }}><Text color={theme['c-primary-font']}>{label}</Text></TouchableOpacity>
  return <Section title="关于 LX Music">
    <View style={{ marginHorizontal: 18, gap: 10 }}>
      <Text size={18} style={{ fontWeight: '600' }}>iOS / iPadOS 移植与适配</Text>
      <Text>维护者：{PORT_PROJECT.maintainer}。基于上游 LX Music 和 Q-1515 的早期 iOS 移植继续开发，提供 iPhone / iPad 播放、缓存、窗口布局、键盘控制与数据同步适配。本版本不是上游官方发布的 iOS 应用。</Text>
      {link('移植项目 · skyhc/lx-music-mobile', PORT_PROJECT.repository)}
      {link('下载移植版最新版本 · GitHub Releases', PORT_PROJECT.releases)}
      <TouchableOpacity accessibilityRole="button" onPress={() => { void feedback() }} style={{ paddingVertical: 10 }}><Text color={theme['c-primary-font']}>提交移植问题 / 复制反馈信息</Text></TouchableOpacity>
      <Text size={18} style={{ fontWeight: '600' }}>上游官方项目</Text>
      <Text>LX Music Mobile（落雪音乐助手），原作者：lyswhut / 落雪无痕。原始移动版面向 Android；本项目保留上游许可与署名，不将 iOS 移植支持归属于原作者。</Text>
      {link('上游官方源码 · lyswhut/lx-music-mobile', PORT_PROJECT.upstream)}
      {link('早期 iOS 移植 · Q-1515', PORT_PROJECT.previousPort)}
      {link('上游官方文档与常见问题', 'https://lyswhut.github.io/lx-music-doc/')}
      <TouchableOpacity onPress={() => showPactModal()} style={{ paddingVertical: 10 }}><Text color={theme['c-primary-font']}>查看许可与使用协议</Text></TouchableOpacity>
      {link('Apache-2.0 开源许可', PORT_PROJECT.repository + '/blob/codex/ios-upstream-1.9.0/LICENSE')}
      <Text size={12}>下载请核对移植仓库、版本及签名。日志反馈前请移除密钥和个人信息。iOS 版本不能通过 Android APK 更新。</Text>
    </View>
  </Section>
})
