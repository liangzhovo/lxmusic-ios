import { useEffect, useState } from 'react'
import { setNavActiveId } from '@/core/common'

export type LibraryTab = 'downloads' | 'webdav' | 'backup'
let request = { tab: 'downloads' as LibraryTab, listId: 'default', revision: 0 }
const listeners = new Set<() => void>()
export function openLibraryPage(tab: LibraryTab, listId = 'default') {
  request = { tab, listId, revision: request.revision + 1 }
  for (const listener of listeners) listener()
  setNavActiveId('nav_library')
}
export function useLibraryPage() {
  const [value, setValue] = useState(request)
  useEffect(() => {
    const update = () => { setValue(request) }
    listeners.add(update); update()
    return () => { listeners.delete(update) }
  }, [])
  return value
}
