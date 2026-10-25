import { memo } from 'react'
import { View } from 'react-native'
import { updateSetting } from '@/core/common'
import { useSettingValue } from '@/store/setting/hook'
import CheckBoxItem from '../../components/CheckBoxItem'
import SubTitle from '../../components/SubTitle'

export default memo(() => {
  const style = useSettingValue('playDetail.coverStyle')
  return <SubTitle title="封面样式">
    <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
      <CheckBoxItem check={style == 'cd'} label="CD" need onChange={() => updateSetting({ 'playDetail.coverStyle': 'cd' })} />
      <CheckBoxItem check={style != 'cd'} label="正方形" need onChange={() => updateSetting({ 'playDetail.coverStyle': 'square' })} />
    </View>
  </SubTitle>
})
