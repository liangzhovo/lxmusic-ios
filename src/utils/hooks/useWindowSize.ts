import { useSyncExternalStore } from 'react'
import { windowSizeTools } from '@/utils/windowSizeTools'

const subscribe = (notify: () => void) => windowSizeTools.onSizeChanged(notify)
const snapshot = () => windowSizeTools.getSize()
export default () => useSyncExternalStore(subscribe, snapshot, snapshot)
