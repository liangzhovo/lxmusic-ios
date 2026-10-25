export {}

declare global {
  namespace LX {
    interface AppSetting {
      /** Playback-detail cover presentation on iOS/iPadOS. */
      'playDetail.coverStyle': 'cd' | 'square'
    }
  }
}
