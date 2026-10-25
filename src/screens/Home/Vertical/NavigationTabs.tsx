import { useSettingValue } from '@/store/setting/hook'
import { showBottomNavigation } from '@/utils/songLayout'
import { View, TouchableOpacity, StyleSheet } from 'react-native'
import { Icon } from '@/components/common/Icon'
import Text from '@/components/common/Text'
import { useTheme } from '@/store/theme/hook'
import { useNavActiveId } from '@/store/common/hook'
import { setNavActiveId } from '@/core/common'
import { NAV_MENUS } from '@/config/constant'
import { useI18n } from '@/lang'

export default () => {
  const theme = useTheme()
  const activeId = useNavActiveId()
  const t = useI18n()
  const hidden = useSettingValue('common.hidePortraitNavigation')
  if (!showBottomNavigation(hidden)) return null
  return <View style={[styles.bar, { borderTopColor: theme['c-border-background'] }]}>
    {NAV_MENUS.map(({ id, icon }) => <TouchableOpacity key={id} style={styles.tab} accessibilityRole="tab"
      accessibilityLabel={t(id)} accessibilityState={{ selected: activeId == id }} onPress={() => setNavActiveId(id)}>
      <Icon name={icon} rawSize={18} color={activeId == id ? theme['c-primary-font'] : theme['c-font-label']} />
      <Text size={10} numberOfLines={1} color={activeId == id ? theme['c-primary-font'] : theme['c-font-label']}>{t(id)}</Text>
    </TouchableOpacity>)}
  </View>
}
const styles = StyleSheet.create({
  bar: { flexDirection: 'row', flexShrink: 0, borderTopWidth: 0.5, minHeight: 50 },
  tab: { flex: 1, minWidth: 0, paddingVertical: 5, minHeight: 48, justifyContent: 'center', alignItems: 'center', gap: 3 },
})
