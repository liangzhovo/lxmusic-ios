import { useRef, forwardRef } from 'react'
import { Platform, View, ScrollView } from 'react-native'
import Dialog, { type DialogType } from '@/components/common/Dialog'
import Button from '../../components/Button'
import { useSettingValue } from '@/store/setting/hook'
import { updateSetting } from '@/core/common'
import CheckBoxItem from '../../components/CheckBoxItem'
import Text from '@/components/common/Text'
const KEYS = ['keyboard.enabled', 'keyboard.playback', 'keyboard.seek', 'keyboard.selection', 'keyboard.navigation'] as const
const LABELS = ['启用外接键盘快捷键', '播放控制：空格播放/暂停，⌘←/→上一首/下一首', '进度控制：←/→快退/快进 5 秒', '列表选择：↑/↓选择，回车播放，⌘L定位当前歌曲', '页面导航：⌘1–5切换页面，Esc关闭菜单']
const Option = ({ index }: { index: number }) => {
  const key = KEYS[index]
  const enabled = useSettingValue('keyboard.enabled')
  const value = useSettingValue(key)
  return <CheckBoxItem disabled={index > 0 && !enabled} check={value} label={LABELS[index]} onChange={value => updateSetting({ [key]: value })} />
}
export const KeyboardOptions = () => <ScrollView style={{ flex: 1, minHeight: 0 }} contentContainerStyle={{ padding: 12 }}>
  {KEYS.map((key, index) => <Option key={key} index={index} />)}
  <Text size={12} style={{ padding: 14 }}>输入文字时不拦截空格、方向键和回车。列表方向键只选择，不自动播放；回车确认播放。修改即时生效并保存。</Text>
</ScrollView>
export const KeyboardConfigurationDialog = forwardRef<DialogType>((_props, ref) =>
  <Dialog ref={ref} position="center" title="键盘控制配置" maxWidth={600} height="80%">
    <KeyboardOptions />
  </Dialog>)
export default () => {
  const dialog = useRef<DialogType>(null)
  if (Platform.OS != 'ios') return null
  return <View style={{ paddingVertical: 10, paddingHorizontal: 14 }}>
    <Button onPress={() => dialog.current?.setVisible(true)}>键盘控制配置</Button>
    <KeyboardConfigurationDialog ref={dialog} />
  </View>
}
