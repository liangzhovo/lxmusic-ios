import { memo } from 'react'
import ListActionBar from '@/components/common/ListActionBar'

import { pop } from '@/navigation'
import commonState from '@/store/common/state'
import { handleCollect, handlePlay } from './listAction'
import songlistState from '@/store/songlist/state'
import { useI18n } from '@/lang'
import { useListInfo } from './state'
// import { NAV_SHEAR_NATIVE_IDS } from '@/config/constant'

export default memo(() => {
  const t = useI18n()
  const info = useListInfo()

  const back = () => {
    void pop(commonState.componentIds.songlistDetail!)
  }

  const handlePlayAll = () => {
    if (!songlistState.listDetailInfo.info.name) return
    void handlePlay(info.id, info.source, songlistState.listDetailInfo.list)
  }

  const handleCollection = () => {
    if (!songlistState.listDetailInfo.info.name) return
    void handleCollect(info.id, info.source, songlistState.listDetailInfo.info.name || info.name)
  }

  return <ListActionBar actions={[
    { label: t('play_all'), onPress: handlePlayAll },
    { label: t('collect_songlist'), onPress: handleCollection },
    { label: t('back'), onPress: back },
  ]} />
})
