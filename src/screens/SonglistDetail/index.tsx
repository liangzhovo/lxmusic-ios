import { View, Platform } from 'react-native'
import { useHorizontalMode } from '@/utils/hooks'
import Aside from '@/screens/Home/Horizontal/Aside'
import { pop } from '@/navigation'
import { useEffect, useRef } from 'react'

import MusicList, { type MusicListType } from './MusicList'
import PageContent from '@/components/PageContent'
import StatusBar from '@/components/common/StatusBar'
import { setComponentId } from '@/core/common'
import { COMPONENT_IDS } from '@/config/constant'
import { type ListInfoItem } from '@/store/songlist/state'
import PlayerBar from '@/components/player/PlayerBar'
import { ListInfoContext } from './state'


export default ({ componentId, info }: { componentId: string, info: ListInfoItem }) => {
  const wide = useHorizontalMode() && Platform.OS == 'ios'
  const musicListRef = useRef<MusicListType>(null)
  const isUnmountedRef = useRef(false)

  useEffect(() => {
    setComponentId(COMPONENT_IDS.songlistDetail, componentId)

    isUnmountedRef.current = false

    musicListRef.current?.loadList(info.source, info.id)


    return () => {
      isUnmountedRef.current = true
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])


  return (
    <PageContent>
      <StatusBar />
      <View style={{ flex: 1, minHeight: 0, flexDirection: 'row' }}>
      {wide ? <Aside onNavigate={() => { void pop(componentId) }} /> : null}
      <View style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
      <ListInfoContext.Provider value={info}>
        <MusicList ref={musicListRef} componentId={componentId} />
      </ListInfoContext.Provider>
      <PlayerBar />
      </View>
      </View>
    </PageContent>
  )
}

// const styles = createStyle({
//   container: {
//     width: '100%',
//     flex: 1,
//     flexDirection: 'row',
//     borderTopWidth: BorderWidths.normal,
//   },
//   content: {
//     flex: 1,
//   },
// })
