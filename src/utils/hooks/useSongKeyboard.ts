import { useContext, useEffect, useRef, useState } from 'react'
import { keyboardRouter, nextKeyboardIndex, type KeyboardAction } from '@/core/keyboardRouter'
import { KeyboardEnabled, KeyboardLayer } from '@/components/KeyboardScope'

export default <T extends { id: string }>(items: T[], onPlay: (item: T, index: number) => void,
  scroll: (index: number) => void, currentId?: string | null, enabled = true) => {
  const pageEnabled = useContext(KeyboardEnabled)
  const layer = useContext(KeyboardLayer)
  const [selectedId, setSelected] = useState<string | null>(null)
  const refs = useRef({ items, onPlay, scroll, currentId, selectedId, enabled: enabled && pageEnabled })
  refs.current = { items, onPlay, scroll, currentId, selectedId, enabled: enabled && pageEnabled }
  useEffect(() => keyboardRouter.register({ layer, enabled: () => refs.current.enabled,
    handle(action: KeyboardAction) {
      const state = refs.current
      if (!state.items.length) return false
      let index = state.items.findIndex(item => item.id == state.selectedId)
      if (action == 'locate_current') {
        index = state.items.findIndex(item => item.id == state.currentId)
        if (index < 0) return false
      } else if (action == 'select_up' || action == 'select_down') {
        index = nextKeyboardIndex(index, action == 'select_up' ? -1 : 1, state.items.length)
      } else if (action == 'select_enter') {
        if (index < 0) return false
        state.onPlay(state.items[index], index); return true
      } else return false
      // Update the ref immediately so fast hardware repeat doesn't use stale state.
      refs.current.selectedId = state.items[index].id
      setSelected(state.items[index].id)
      state.scroll(index)
      return true
    },
  }), [layer])
  return selectedId
}
