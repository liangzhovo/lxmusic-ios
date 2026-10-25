# 官方 1.9.0 移植记录 · Build 83

## 基线与范围
- 已验收 iOS 基线：`3f008d3599f29ceeaf7925e5935882a78a3052ff`（Build82，PR#2 已合并）。
- 固定官方 release：v1.9.0 / `cd37a979a5845f1220b306b374285f5d38329e8d`，不是浮动 master。
- 通过三方合并审查上游变化，保留 iOS 原生引擎、Scene、深浅主题、响应式窗口与菜单。
- iOS 显示版本1.9.0，Build83；Bundle ID沿用com.skyhc.lxmusic。

## 对官方变化逐文件核对

| 路径 | 处理 |
|---|---|
| `CHANGELOG.md` | 保留 iOS 适配并合并上游逻辑；冲突人工逐段审查 |
| `android/app/build.gradle` | 原样引入官方文件 |
| `android/app/src/main/java/cn/toside/music/mobile/lyric/LyricPlayer.java` | 原样引入官方文件 |
| `package-lock.json` | 保留 iOS 适配并合并上游逻辑；冲突人工逐段审查 |
| `package.json` | 保留 iOS 适配并合并上游逻辑；冲突人工逐段审查 |
| `publish/changeLog.md` | 原样引入官方文件 |
| `publish/utils/index.js` | 原样引入官方文件 |
| `publish/version.json` | 原样引入官方文件 |
| `src/components/OnlineList/ListMenu.tsx` | 保留 iOS 适配并合并上游逻辑；冲突人工逐段审查 |
| `src/components/OnlineList/index.tsx` | 原样引入官方文件 |
| `src/components/OnlineList/listAction.ts` | 保留 iOS 适配并合并上游逻辑；冲突人工逐段审查 |
| `src/components/player/PlayerBar/components/Title.tsx` | 原样引入官方文件 |
| `src/config/defaultSetting.ts` | 保留 iOS 适配并合并上游逻辑；冲突人工逐段审查 |
| `src/core/init/player/lyric.ts` | 保留 iOS 适配并合并上游逻辑；冲突人工逐段审查 |
| `src/core/init/player/playStatus.ts` | 保留 iOS 适配并合并上游逻辑；冲突人工逐段审查 |
| `src/core/init/player/player.ts` | 保留 iOS 适配并合并上游逻辑；冲突人工逐段审查 |
| `src/core/lyric.ts` | 保留 iOS 适配并合并上游逻辑；冲突人工逐段审查 |
| `src/lang/en-us.json` | 保留 iOS 适配并合并上游逻辑；冲突人工逐段审查 |
| `src/lang/zh-cn.json` | 保留 iOS 适配并合并上游逻辑；冲突人工逐段审查 |
| `src/lang/zh-tw.json` | 保留 iOS 适配并合并上游逻辑；冲突人工逐段审查 |
| `src/plugins/player/playList.ts` | 保留 iOS 适配并合并上游逻辑；冲突人工逐段审查 |
| `src/plugins/player/utils.ts` | 保留 iOS 适配并合并上游逻辑；冲突人工逐段审查 |
| `src/screens/Home/Views/Mylist/MusicList/ListMenu.tsx` | 保留 iOS 适配并合并上游逻辑；冲突人工逐段审查 |
| `src/screens/Home/Views/Mylist/MusicList/index.tsx` | 保留 iOS 适配并合并上游逻辑；冲突人工逐段审查 |
| `src/screens/Home/Views/Mylist/MusicList/listAction.ts` | 保留 iOS 适配并合并上游逻辑；冲突人工逐段审查 |
| `src/screens/Home/Views/Setting/settings/Player/IsShowBluetoothFullLyric.tsx` | 保留 iOS 适配并合并上游逻辑；冲突人工逐段审查 |
| `src/screens/Home/Views/Setting/settings/Player/IsShowBluetoothLyric.tsx` | 原样引入官方文件 |
| `src/screens/Home/Views/Setting/settings/Player/index.tsx` | 保留 iOS 适配并合并上游逻辑；冲突人工逐段审查 |
| `src/screens/PlayDetail/components/SettingPopup/settings/SettingPlaybackRate.tsx` | 保留 iOS 适配并合并上游逻辑；冲突人工逐段审查 |
| `src/types/app_setting.d.ts` | 保留 iOS 适配并合并上游逻辑；冲突人工逐段审查 |
| `src/utils/common.ts` | 保留 iOS 适配并合并上游逻辑；冲突人工逐段审查 |
| `src/utils/data.ts` | 保留 iOS 适配并合并上游逻辑；冲突人工逐段审查 |
| `src/utils/errorHandle.ts` | 原样引入官方文件 |
| `src/utils/musicSdk/index.js` | 原样引入官方文件 |
| `src/utils/musicSdk/kg/lyric.js` | 原样引入官方文件 |
| `src/utils/musicSdk/kg/musicSearch.js` | 原样引入官方文件 |
| `src/utils/musicSdk/kw/decodeLyric.js` | 原样引入官方文件 |
| `src/utils/musicSdk/kw/lyric.js` | 原样引入官方文件 |
| `src/utils/musicSdk/kw/songList.js` | 原样引入官方文件 |
| `src/utils/musicSdk/kw/util.js` | 原样引入官方文件 |
| `src/utils/musicSdk/mg/lyric.js` | 原样引入官方文件 |
| `src/utils/musicSdk/mg/pic.js` | 原样引入官方文件 |
| `src/utils/musicSdk/mg/songId.js` | 原样引入官方文件 |
| `src/utils/musicSdk/tx/index.js` | 原样引入官方文件 |
| `src/utils/musicSdk/tx/lyric.js` | 保留 iOS 适配并合并上游逻辑；冲突人工逐段审查 |
| `src/utils/musicSdk/tx/musicSearch.js` | 原样引入官方文件 |
| `src/utils/musicSdk/tx/qrcDecode.js` | 保留 iOS 适配并合并上游逻辑；冲突人工逐段审查 |
| `src/utils/musicSdk/tx/songList.js` | 保留 iOS 适配并合并上游逻辑；冲突人工逐段审查 |
| `src/utils/musicSdk/versionChars.ts` | 原样引入官方文件 |
| `src/utils/musicSdk/wy/lyric.js` | 原样引入官方文件 |
| `src/utils/tools.ts` | 保留 iOS 适配并合并上游逻辑；冲突人工逐段审查 |
| `tsconfig.json` | 原样引入官方文件 |

## iOS 兼容处理

1. 歌曲操作“清理缓存”清理指定曲目全部音质 URL 和完整音频，保留当前播放副本与其他曲目。并发清理后旧请求不得重新发布缓存，真正的存储错误必须返回失败。
2. 完整蓝牙歌词为 Android 元数据扩展；iOS 继续现有逐行锁屏信息，不展示不能工作的开关。TrackPlayer 的新对象参数 API 已加平台隔离。
3. 官方纯 JS QRC 解码取代旧模块入口，保留本分支较完整的逐字时间解析、歌词回退与请求清理。Buffer 采用显式 React Native 导入。
4. 歌单搜索融合官方名称/歌手/专辑优先级与既有标点规整；来源文字、单行菜单与宽窄排版不回退。
5. 依赖、npm锁文件与官方同步，保留iOS postinstall补丁。只更新TrackPlayer的Android及TS包装接口；其iOS原生文件不在上游此次变更中。

## 验证计划与边界

- `check-upstream190.js` 执行缓存修订号/清理并发/离线优先/版本匹配/接口隔离与官方文件一致性测试。
- 保留既有缓存、列表持久化、Build79–82界面回归；当前项目TypeScript必须0诊断。
- Actions Release 模拟器执行MP3/FLAC流式播放、音量、暂停/恢复、跳转、跨引擎、离线新进程、单曲清理仍保持播放。保留36张生产组件截图门禁。
- 之后编译设备版Release Archive，核对包版本与SHA256后提供未签名IPA和Archive。
- 当前文件是实现范围记录，不预先声明CI通过。真实外部音源服务、用户自定义音源、真机输出及蓝牙车机需安装验证；不使用APK冒充IPA。
