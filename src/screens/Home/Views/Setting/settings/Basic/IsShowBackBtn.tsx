import { updateSetting } from '@/core/common'
import { useI18n } from '@/lang'
import { createStyle } from '@/utils/tools'
import { memo } from 'react'
import { View, Platform } from 'react-native'
import { useSettingValue } from '@/store/setting/hook'


import CheckBoxItem from '../../components/CheckBoxItem'

export default memo(() => {
  const t = useI18n()
  const showBackBtn = useSettingValue('common.showBackBtn')
  const setShowBackBtn = (showBackBtn: boolean) => {
    updateSetting({ 'common.showBackBtn': showBackBtn })
  }

  return (
    <View style={styles.content}>
      <CheckBoxItem disabled={Platform.OS == 'ios'} helpDesc={Platform.OS == 'ios' ? 'iOS 不提供 Android 式返回桌面接口；设置值保留，可用系统手势返回桌面。' : undefined} check={showBackBtn} label={t('setting_basic_show_back_btn')} onChange={setShowBackBtn} />
    </View>
  )
})


const styles = createStyle({
  content: {
    marginTop: 5,
  },
})
