import { ScrollView, View } from 'react-native'
import Button from './Button'
import Text from './Text'
import { useTheme } from '@/store/theme/hook'

export interface ListAction { label: string, onPress: () => void, disabled?: boolean }
export default ({ actions }: { actions: ListAction[] }) => {
  const theme = useTheme()
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 1 }}
    contentContainerStyle={{ alignItems: 'center', gap: 8, paddingHorizontal: 8, paddingVertical: 6 }}>
    {actions.map(action => <Button key={action.label} accessibilityRole="button" accessibilityLabel={action.label}
      disabled={action.disabled} onPress={action.onPress}
      style={{ flexShrink: 0, minHeight: 44, borderRadius: 8, paddingHorizontal: 12, justifyContent: 'center', backgroundColor: theme['c-button-background'] }}>
      <View style={{ flexShrink: 0 }}><Text size={14} numberOfLines={1} color={theme['c-button-font']} style={{ flexShrink: 0 }}>{action.label}</Text></View>
    </Button>)}
  </ScrollView>
}
