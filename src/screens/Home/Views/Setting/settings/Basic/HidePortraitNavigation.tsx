import { Platform, View } from 'react-native'
import { useSettingValue } from '@/store/setting/hook'
import { updateSetting } from '@/core/common'
import CheckBoxItem from '../../components/CheckBoxItem'
import Text from '@/components/common/Text'
import { useTheme } from '@/store/theme/hook'

export default () => {
  const hidden = useSettingValue('common.hidePortraitNavigation')
  const theme = useTheme()
  if (Platform.OS != 'ios') return null
  return <View style={{ marginTop: 5 }}>
    <CheckBoxItem check={hidden} label="竖屏／窄窗口隐藏底部导航" onChange={value => updateSetting({ 'common.hidePortraitNavigation': value })} />
    <Text size={12} color={theme['c-font-label']} style={{ paddingHorizontal: 10, paddingBottom: 6 }}>
      隐藏搜索、歌单、排行榜、我的列表、设置。仍可从顶部菜单进入这些页面；横屏侧栏不受影响。
    </Text>
  </View>
}
