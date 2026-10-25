// Independent appearance presets follow lx-music-desktop's ThemeSelectorModal
// semantics; rendering uses the mobile application's existing Dialog/Theme UI.
import { forwardRef, useEffect, useState } from 'react'
import { ScrollView, TouchableOpacity, View, type ImageSourcePropType } from 'react-native'
import Dialog, { type DialogType } from '@/components/common/Dialog'
import Text from '@/components/common/Text'
import ImageBackground from '@/components/common/ImageBackground'
import { useI18n } from '@/lang'
import { useTheme } from '@/store/theme/hook'
import { useSettingValue } from '@/store/setting/hook'
import { BG_IMAGES, getAllThemes } from '@/theme/themes'
import { selectSystemTheme } from '@/theme/systemTheme'
import { setThemeVariant } from '@/core/theme'
import { toast } from '@/utils/tools'

const useCatalog = () => {
  const [info, setInfo] = useState<{ themes: LX.Theme[], dataPath: string }>({ themes: [], dataPath: '' })
  useEffect(() => {
    let alive = true
    void getAllThemes().then(all => { if (alive) setInfo({ themes: [...all.themes, ...all.userThemes], dataPath: all.dataPath }) }).catch(() => {})
    return () => { alive = false }
  }, [])
  return info
}
const useSelection = () => {
  const id = useSettingValue('theme.id')
  const lightId = useSettingValue('theme.lightId')
  const darkId = useSettingValue('theme.darkId')
  const legacyAuto = useSettingValue('common.isAutoTheme')
  return {
    'theme.id': id,
    // Old automatic mode stored the light preset in theme.id. Match the
    // resolver without rewriting the user's settings merely to render a swatch.
    'theme.lightId': legacyAuto && id != 'auto' ? id : lightId,
    'theme.darkId': darkId,
    'common.isAutoTheme': legacyAuto,
  }
}
const previewImage = (theme: LX.Theme, dataPath: string): ImageSourcePropType | undefined => {
  const image = theme.config.extInfo['bg-image']
  if (!image) return
  if (!theme.isCustom) return BG_IMAGES[image as keyof typeof BG_IMAGES]
  return { uri: /^(https?:|file:)/.test(image) ? image : `file://${dataPath}/${image}` }
}

export const ThemePreset = ({ item, selected, dataPath, onPress }: {
  item: LX.Theme, selected: boolean, dataPath: string, onPress: () => void,
}) => {
  const theme = useTheme(), t = useI18n()
  const name = item.isCustom ? item.name : t(`theme_${item.id}` as Parameters<typeof t>[0])
  const source = previewImage(item, dataPath)
  const fill = { width: 30, height: 30, borderRadius: 3, backgroundColor: item.config.themeColors['c-theme'] }
  return <TouchableOpacity accessibilityRole="radio" accessibilityLabel={name} accessibilityState={{ selected }}
    testID={`system-theme-${item.isDark ? 'dark' : 'light'}-${item.id}`} onPress={onPress}
    style={{ width: 84, alignItems: 'center', paddingVertical: 6 }}>
    <View style={{ width: 38, height: 38, borderWidth: 2, borderRadius: 5, alignItems: 'center', justifyContent: 'center',
      borderColor: selected ? theme['c-primary-font'] : 'transparent' }}>
      {source ? <ImageBackground source={source} style={fill} imageStyle={{ borderRadius: 3 }} /> : <View style={fill} />}
    </View>
    <Text size={12} numberOfLines={1} style={{ marginTop: 3 }} color={selected ? theme['c-primary-font'] : theme['c-font']}>{name}</Text>
  </TouchableOpacity>
}

export const AutoThemeItem = ({ onPress, visible }: { onPress: () => void, visible: boolean }) => {
  const t = useI18n(), theme = useTheme(), setting = useSelection(), info = useCatalog()
  const selected = setting['theme.id'] == 'auto' || setting['common.isAutoTheme']
  if (!visible && !selected) return null
  const auto = { ...setting, 'theme.id': 'auto' }
  const light = info.themes.length ? selectSystemTheme(info.themes, auto, false).config.themeColors['c-theme'] : '#4daf7c'
  const dark = info.themes.length ? selectSystemTheme(info.themes, auto, true).config.themeColors['c-theme'] : '#333333'
  return <TouchableOpacity testID="theme-auto" accessibilityRole="button" accessibilityLabel={t('theme_auto')}
    accessibilityState={{ selected }} onPress={onPress} style={{ width: 72, alignItems: 'center' }}>
    <View style={{ width: 38, height: 38, padding: 3, borderRadius: 5, borderWidth: 2,
      borderColor: selected ? theme['c-primary-font'] : 'transparent' }}>
      <View style={{ flex: 1, overflow: 'hidden', borderRadius: 3, backgroundColor: light }}>
        <View style={{ position: 'absolute', right: 0, bottom: 0, width: 0, height: 0,
          borderLeftWidth: 28, borderBottomWidth: 28, borderLeftColor: 'transparent', borderBottomColor: dark }} />
      </View>
    </View>
    <Text size={12} color={selected ? theme['c-primary-font'] : theme['c-font']} style={{ marginTop: 2 }}>{t('theme_auto')}</Text>
  </TouchableOpacity>
}

export const AutoThemeDialog = forwardRef<DialogType>((_props, ref) => {
  const t = useI18n(), info = useCatalog(), setting = useSelection()
  const presets = { ...setting, 'theme.id': 'auto' }
  const selectedIds = info.themes.length
    ? [false, true].map(dark => selectSystemTheme(info.themes, presets, dark).id) : []
  return <Dialog ref={ref} title={t('theme_selector_modal__title')} maxWidth={720}>
    <ScrollView testID="system-theme-selector" style={{ flexShrink: 1 }} contentContainerStyle={{ padding: 16 }}>
      {[false, true].map(dark => <View key={String(dark)} style={{ marginBottom: 14 }}>
        <Text size={14} style={{ marginBottom: 8 }}>{t(dark ? 'theme_selector_modal__dark_title' : 'theme_selector_modal__light_title')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
          {info.themes.filter(item => item.isDark == dark).map(item => <ThemePreset key={item.id} item={item} dataPath={info.dataPath}
            selected={item.id == selectedIds[dark ? 1 : 0]}
            onPress={() => { void setThemeVariant(item.id, dark).catch(() => toast(t('theme_selector_error'))) }} />)}
        </View>
      </View>)}
    </ScrollView>
    <Text size={12} style={{ paddingHorizontal: 16, paddingBottom: 14 }}>{t('theme_selector_modal__title_tip')}</Text>
  </Dialog>
})
