# 从 LX Music 原始移动版到 iOS / iPadOS 移植版

本记录说明 **1.9.0 / Build87** 中实际保留的改动，不把修复过程中已经放弃的实验方案当作现有功能。已编译版本为 `a29a9d758fd601d42fd22a4a5e1d009537a2df73`，验证运行 [Actions #88 / 35008293921](https://github.com/skyhc/lx-music-mobile/actions/runs/35008293921)。

## 1. 来源与继承关系

- 官方移动版基线：`lyswhut/lx-music-mobile` 的 **v1.9.0**，固定提交 `cd37a979a5845f1220b306b374285f5d38329e8d`。
- 前期 iOS 工程参考与来源：`Q-1515/lx-music-mobile`；本仓库由 skyhc 在此基础上继续适配。
- 独立亮 / 暗主题交互参考：`lyswhut/lx-music-desktop@abcbf5fa00b0b9f2c532a80b10ad8906ee4b22ab`。
- 原有歌曲搜索、排行榜、歌单、歌词、自定义源、备份、语言设置和同步体系属于继承功能，不宣称是本移植首次实现。
- 官方 v1.9.0 的搜索、歌单分页、歌词、图片、版本匹配及 URL 缓存清理修复已审查合入；详见 [逐文件上游移植记录](UPSTREAM_1_9_0_PORT.md)。这些在线服务修复不意味着任意外部音源长期可用。

## 2. 平台工程与原生桥接

| 原始移动版侧重点 | 本移植的适配 |
| --- | --- |
| Android 发布和平台调用 | 建立可编译、归档和签名导出的 iOS 工程；本次发布最低 iOS / iPadOS 15.0、arm64、iPhone + iPad 双设备类型 |
| 移动端 JS / TS 业务 | 保留原有业务，补充 Swift、Objective-C++、C++ 与 React Native 桥接 |
| 文件、压缩、加密等平台能力 | 适配 iOS 文件 / URL 打开、文档选择、沙盒持久数据、异步原生加密及压缩编码路径 |
| Android 应用发布介绍 | 关于页、版本入口、反馈入口指向本移植仓库，区分上游与社区移植维护者 |

对应实现主要位于 `ios/LxMusicMobile/AppDelegate.mm`、`main.m`、`Info.plist`、`ios/Podfile`、`dependencies-patch.js` 及 `src/utils/nativeModules/`。保留原作者与第三方许可，不以 iOS 移植名义覆盖其署名。

## 3. 播放器、音频会话和媒体信息

- 系统音频链路：TrackPlayer / AVFoundation，覆盖 MP3 网络起播、暂停恢复、音量与进度读取。
- FLAC 链路：引入本地 libFLAC 构建与 AVAudioEngine 播放，保留同一应用的播放状态、控制与缓存接口。
- 适配后台音频会话、系统 Now Playing 信息、控制中心 / 锁屏远程指令和逐行歌词。
- 资源加载、播放状态与曲目代次隔离；首次零位置起播不等待多余的 seek(0)。
- 从远程资源切换到本地缓存时，iOS 先完成 reset 再加入唯一资源，避免加载期间异步删除旧队列项触发额外 track-changed；Android 原路径没有被改成 iOS 路径。
- TrackPlayer 的时间读取使用 AVPlayer periodic time observer 提供的真实 CMTime 快照，降低同步 currentTime 读取造成的阻塞；不是根据墙上时钟伪造播放进度。

主要路径：`src/plugins/player/engine/`、`trackPlayerCore.ts`、`nativeFlac.ts`、`patches/ios/cache-swift-audio-position.cjs`、`src/core/player/`。后续实验用的全主线程调度 / KVO 改写脚本虽保留作历史材料，但不是当前生产安装路径。

## 4. 原生音效与音量

接入十段均衡器、音调、卷积、动态限制和声像处理，保留音效预设与控制界面；共享卷积核位于 `LXSharedIRConvolutionKernel.hpp`，处理顺序和参数见 `config/soundEffectDspProfile.json`。系统播放链使用 audioMix 适配，FLAC 保留原生 PCM 处理链。

修复音量控件挂载 / 布局回调误写音量，进入面板时恢复保存值，提供恢复 100% 入口；关闭 EQ 时不应用残留频段参数。Actions 对 MP3 原生音量和 FLAC 后混音 PCM 做增益检查，但没有穷举所有音效预设、耳机、扬声器和蓝牙设备的听感。

## 5. 持久音频缓存与清理

- 完整音频位于应用 `Library/Application Support/LXAudioCache/v1`，与临时播放缓冲分开，排除 iCloud 备份。
- 以来源、歌曲标识和实际音质识别内容，不以会变化的 URL 作为唯一键；校验完整响应、长度、格式和 SHA-256 后再发布索引。
- 本地缓存读取优先于重新解析在线音源，索引可跨进程恢复；设置容量与最近使用淘汰保留。
- 起播不等待可选缓存任务；FLAC 复用已有完整响应，系统播放器缓存不抢占首次起播关键路径。
- 单曲清理涵盖该曲全部音质 URL / 完整音频；全局清理和淘汰不破坏正在播放的资源副本（lease）。旧任务迟到不能把已清理内容重新登记回来。
- 未完成或损坏文件不会冒充可离线播放的缓存；卸载应用会删除沙盒。

主要路径：`src/plugins/player/cache/`、`src/core/music/cache.ts`、`src/plugins/player/engine/resourceLoader.ts`。参见 [缓存适配记录](IPAD_PLAYER_LAYOUT_CACHE_STATUS.md)，其中早期面板方向描述已被后续界面修复更新，以本记录和当前源码为准。

## 6. iPad / iPhone 与窗口布局

- 引入 UIKit Scene 生命周期，维持一套 Scene / Window / React Native bridge；窗口重新连接不重置播放器。
- 适配系统窗口控件样式与垂直安全布局区域，不使用私有接口移动或伪造系统红绿灯。
- PageContent、Modal、Popup 和 Dialog 共用安全区策略；新的原生窗口重置上下文，同一窗口嵌套面板避免重复加边距。
- 根据实际窗口宽高切换：宽窗口保留侧栏、表格与分栏播放器；竖屏 / 窄窗口进入紧凑界面。字体和图标尺寸不随反复缩放累积变小。
- 横屏播放器左侧为封面、曲目信息、时间和控制，右侧为歌词；低高度窗口左区可滚动。
- 歌单详情与主列表的底部播放栏以内容区为基准，修复侧栏外溢和重复标题。

主要路径：`WindowContent.tsx`、`LXWindowInsets.swift`、`windowSizeTools.ts`、`src/screens/Home/Horizontal/`、`src/screens/PlayDetail/Horizontal/`。

## 7. 列表、菜单、收藏与视觉层级

- 在线歌曲 / 我的列表统一单行内容；宽窗口使用一致的歌名、歌手、专辑、时长列和透明表头，窄窗口减少低优先级列。
- 保留点击、长按、更多菜单、多选、来源标识、当前播放标记和定位当前曲目。
- 歌单列表持久化一次性初始化；删除、同步与迟到读取通过串行持久化和快照隔离，避免已删列表在重启后复活。
- 操作菜单保持触发位置附近，完整显示文字、无整窗暗幕；收藏和确认居中，播放器播放列表在相应宽屏场景侧向展示，其余面板保留调用方方向。
- 去掉修复过程中额外添加的导航 / 列表标题 / 菜单选中底板；保留上游原有输入框、多选和容器背景。
- 三个共享强调文字色与播放行颜色同时检查背景对比度、有彩色色度和与普通 / 辅助正文的差异。彩色主题尽量保留色相，中性主题不回退成普通黑白灰。

主要路径：`SongRowContent.tsx`、`SongTableHeader.tsx`、`Menu.tsx`、`src/utils/playingColor.ts`、`themeAccent.ts`、`selectionColors.ts`。这不是对任意自定义背景图片逐像素对比度的保证。

## 8. 外接键盘与 Build87 连续 Seek

提供播放、前后曲、前后跳转、列表选择、Enter、当前曲目定位及主导航指令，并保留总开关与分项设置。输入框获得焦点时不覆盖其编辑按键，弹窗 / 当前页面通过作用域分发，隐藏页面不响应。

Build87 针对快速连续 seek 修复了两个问题：旧 seek 验证器重复提交捕获的旧目标；旧异步完成结果与旧进度轮询覆盖最新 UI。现在立即累计显示目标、120 ms 合并连续输入、保持一个执行中的 seek，并通过代次检查丢弃过期结果。切歌、停止、错误与监听清理会取消待处理请求，零秒是有效值。原生 seek 提交后只读取真实位置，不再反复拉回历史目标。

主要路径：`src/core/player/latestSeek.ts`、`src/core/init/player/playProgress.ts`、`remoteCommand.ts`、`src/plugins/player/seek.ts`。原生查询的 3000 ms 门槛未延长。

## 9. 桌面版独立亮暗预设的原生适配

- 新增“道法自然”双色入口和按亮色 / 暗色分组的预设选择。
- 自动模式使用 `theme.id=auto`，独立保存 `theme.lightId` / `theme.darkId`，兼容既有自动主题开关与旧设置。
- 启动、系统 Appearance 变化、回到前台和设置编辑触发刷新；异步结果带代次保护。固定主题忽略系统变动。
- 自动模式清除窗口外观 override；从系统 Scene 获取真实偏好，不把之前强制的窗口亮色当成系统亮色。
- 失效 / 删除的预设在同一亮暗分组内回退，修改当前未激活的预设不打断显示。
- 修复 iOS 能力门槛误读 Android-only `Platform.constants.Release` 的问题，使用实际 `Platform.Version` 安装系统外观监听。

参见 [Build87 实现与回归记录](BUILD87_SEEK_THEME.md)。这是 React Native / UIKit 适配，不是把桌面版 Electron 页面塞入应用。

## 10. 同步协议与数据保留

与官方 v4 同步协议保持兼容，保留发现、设备识别、配对、AES / RSA、压缩消息及显式合并方向。iOS 使用已有异步原生加密接口；中文 / emoji 编码、配对摘要和压缩使用明确的 JS 编解码路径。

补充按阶段错误提示与脱敏诊断、取消 / 超时、会话隔离、断线重连，修复目录持久化与迟到快照竞争。独立官方同步服务和桌面协议客户端验证双向增删改及重启恢复，但并非对每位用户私人电脑或局域网的远程验收。

旧设置文件和保存值保留；Android 专用能力不会伪装成 iOS 原生能力。关于页和发布入口不再引导安装 APK。

## 11. 构建、测试与交付

当前 iOS CI 保留依赖安装、CocoaPods、全项目 TypeScript、缓存 / 列表 / 布局 / 主题专项、真实 Release 模拟器、官方同步对端、MP3 / FLAC 在线和离线新进程、系统外观切换 / 重启、54 张原有截图及新增主题截图，再进行设备 Archive 和 IPA 元数据 / SHA-256 校验。

Build87 的 Actions #88 实际通过：**32 项在线、11 项离线 / 重启、8 项系统主题及 2 项主题重启检查，54 + 3 张截图**。每种格式各有一项原生快捷键 burst 检查。发布脚本重新校验源运行、二进制哈希、报告与图片后才发布 Release；不把重新上传误称为重新编译。

发布的 IPA 和 Archive 均未签名。没有完成的范围：个人证书签名 / 真机安装、TestFlight / App Store、全量第三方音源、所有实体键盘和系统窗口交互、设备长时间稳定性及主观听感。

## 12. 本次主线整理（不改变 Build87 应用二进制）

将 `codex/ios-upstream-1.9.0` 的已验证代码提升为默认 `master`。合并提交保留旧 master 与开发分支的历史；清理前核对各旧分支 HEAD，并建立归档标签。新的仓库首页和本文用于替换旧 Android 介绍；旧 README 与 Android CI 作为历史资料保留，当前构建发布入口只面向 iOS / iPadOS。

Release 标签固定到真实编译提交 `a29a9d7`；后续文档 / 仓库整理提交不会冒充这个 IPA 的构建提交。既有 v1.8.2 Release 与历史提交不删除。
