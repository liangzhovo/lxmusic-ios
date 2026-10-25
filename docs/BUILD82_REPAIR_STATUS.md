# Build82 修改与构建范围

基线：ca37322e62255734e017aab8fac57b5e81f7724c（Build81）。
本轮包含重复标题、深色状态栏、表头背景/对齐、完整菜单文案、窗口原生 minimal 样式与安全区、无变暗遮罩及音源标签七项修复。
完整变更见根目录 CHANGELOG.md 的 1.8.2 Build82 条目。

只创建一套 scene/window/React Native bridge；重新连接窗口不重置播放器。未改生产播放引擎、音量和缓存逻辑。AppDelegate 冷启动 URL 参数和 SceneDelegate 的打开文件/URL/用户活动转发保留。新 SceneDelegate 属于公开 UIKit 生命周期集成，不使用私有按钮重定位。

需要 Actions 确认：全项目 TypeScript、既有行为测试、原生 MP3/FLAC/离线重启、scene 关联与 minimal 样式、深色/浅色状态栏运行值、36 张生产组件截图、设备 Archive 编译与 IPA/archive 文件元数据和哈希。打包产物未签名，不自动合并、不修改签名密钥。

官方依据：
- https://developer.apple.com/documentation/uikit/uiwindowscenedelegate/preferredwindowingcontrolstyle(for:)
- https://developer.apple.com/documentation/uikit/uiwindowscene/windowingcontrolstyle
- https://developer.apple.com/documentation/uikit/uiview/safearealayoutguide
