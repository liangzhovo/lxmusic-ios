import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { Navigation } from 'react-native-navigation'
import { useNavActiveId } from '@/store/common/hook'
import type { NAV_ID_Type } from '@/config/constant'
export const KeyboardLayer = createContext(0)
export const KeyboardEnabled = createContext(true)
export const KeyboardScreen = ({ componentId, children }: { componentId: string, children: ReactNode }) => {
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    const subscription = Navigation.events().registerComponentListener({
      componentDidAppear: () => setVisible(true), componentDidDisappear: () => setVisible(false),
    }, componentId)
    return () => subscription.remove()
  }, [componentId])
  return <KeyboardEnabled.Provider value={visible}>{children}</KeyboardEnabled.Provider>
}
export const KeyboardPage = ({ navId, children }: { navId: NAV_ID_Type, children: ReactNode }) => {
  const parent = useContext(KeyboardEnabled)
  const active = useNavActiveId()
  return <KeyboardEnabled.Provider value={parent && active == navId}>{children}</KeyboardEnabled.Provider>
}
