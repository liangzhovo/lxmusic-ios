import { memo, useRef } from 'react'
import { TouchableOpacity, View } from 'react-native'
import CheckBoxItem from '../../components/CheckBoxItem'
import { getIsSupportedAutoTheme } from '@/utils/tools'
import { useI18n } from '@/lang'
import { setAutoTheme } from '@/core/theme'
import { useSettingValue } from '@/store/setting/hook'
import { useTheme } from '@/store/theme/hook'
import Text from '@/components/common/Text'
import type { DialogType } from '@/components/common/Dialog'
import { AutoThemeDialog } from './AutoTheme'

export default memo(() => {
  const t = useI18n(), theme = useTheme()
  const enabled = useSettingValue('common.isAutoTheme')
  const id = useSettingValue('theme.id')
  const dialog = useRef<DialogType>(null)
  if (!getIsSupportedAutoTheme()) return null
  return <View style={{ marginTop: 5 }}>
    <CheckBoxItem check={enabled || id == 'auto'} label={t('setting_basic_theme_auto_theme')} onChange={setAutoTheme} />
    <TouchableOpacity onPress={() => dialog.current?.setVisible(true)} accessibilityRole="button" style={{ alignSelf: 'flex-start', padding: 10 }}>
      <Text size={13} color={theme['c-primary-font']}>{t('theme_selector_modal__title')}</Text>
    </TouchableOpacity>
    <AutoThemeDialog ref={dialog} />
  </View>
})
