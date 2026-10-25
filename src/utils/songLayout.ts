// One row policy for online songs, charts, the library and player queues.
export const SONG_ROW_HEIGHT = 64
export const SONG_ACTION_WIDTH = 56
export const SONG_NUMBER_WIDTH = 38
export const SONG_COLUMN_GAP = 16
export const SONG_TIME_WIDTH = 70
export const SONG_TRAILING_GAP = 14
export const songColumns = (width: number, horizontal: boolean, showAlbum = true, showInterval = true) => ({
  compact: !horizontal,
  album: horizontal && showAlbum && width >= 540,
  time: showInterval,
})
export const showBottomNavigation = (hidden: boolean) => !hidden
