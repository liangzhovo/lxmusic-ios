# iPad 横屏播放器与持久缓存 · v1.8.2 Build 78

## 五项需求对应代码

1. 收起箭头保持原有左侧横坐标，不继承系统横向安全区；顶部使用 iOS 26 `safeArea(cornerAdaptation: .vertical)`，旧系统回退为至少 36 点并留 4 点间隔。
2. PageContent、通用 Modal、Popup 与 Dialog 共用 WindowContent；新的原生 Modal 重置安全区上下文，同一窗口内嵌套面板只消费一次安全区。系统红绿灯由 iPadOS 管理，不使用私有 API 移动它们。
3. 横屏左栏容纳封面、歌曲名/歌手、进度/时间、两行控制；右栏歌词。矮窗口左栏可独立滚动，保持各按钮可访问，普通尺寸封面按剩余空间缩放。
4. iOS 完整音频存入 Library/Application Support/LXAudioCache/v1，排除 iCloud 备份。歌曲来源、ID 和实际音质作为缓存键，不用临时 URL 作键；读取先于联网解析。只有完整响应、文件长度与格式头有效、SHA-256 校验通过的文件才发布索引。重启恢复索引，部分文件不被当作缓存。TrackPlayer 读取本地文件；FLAC 本地文件进入现有 libFLAC/AVAudioEngine 链路，不改换引擎。
5. iPad 横屏设置、音效、播放列表、定时及收藏添加编辑面板全部走左侧 Popup，并从左侧滑入。其余平台及竖屏保留原方向。

## 缓存运行边界

- 复用现有缓存容量设置，单位 MiB；0/空表示关闭缓存。完整缓存按最近使用时间淘汰。
- 首次播放继续流式起播，同时最多额外进行一个完整音频缓存下载。因此首次未命中时可能多一次传输；不把“正在播放的部分缓冲”冒充完整持久缓存。
- 下一曲仅预解析地址，不取消当前歌曲的缓存写入；正式播放才安排缓存下载。快速切歌会取消旧的未完成缓存任务。
- 清理通过新一代目录与任务版本隔离，旧任务的迟到回调不可重新发布缓存。当前播放使用独立文件副本，清理/淘汰及配置重载不破坏当前资源。该副本在换曲后或下次启动清理。
- 完整缓存命中不需要解析音源 URL；歌词和封面仍使用已有独立缓存。没有缓存或文件损坏时回退现有联网路径，断网时无法凭空播放未缓存的歌曲。
- 卸载 App 会删除沙盒；只更新安装不应清除缓存。

## 验证入口

- `node scripts/check-audio-cache.js`：真实磁盘、HTTP 与独立新进程离线命中测试，覆盖完整性、音质隔离、URL 更新、容量、清理并发与播放文件副本。
- `node scripts/check-ipad-player-layout.js` 与 `node scripts/check-ipad-window-layout.js`：语法和布局源码规则检查，不是截图测试。
- `node scripts/check-build78-integration.js`：缓存接入与原生/界面源文件检查。
- GitHub Actions：macOS 26 / Xcode 26.6，编译真实 Release Archive，核验版本、Bundle ID、设备类型和 JS Bundle，打包未签名 IPA 与 `.xcarchive.zip`，附提交标识和 SHA-256。

本文件不预先宣称任何 Actions 运行成功。以对应提交的 job conclusion、日志及产物为准。自动化文件缓存测试不是 iPad 真机断网或触控截图测试；实体设备视觉、音频输出和系统窗口交互仍需安装后回归。
