# Build 81 修复与交付范围

基线：9633120711676848d3cacd01e3e2cc308b2bdfc6 / Build 80。
版本：1.8.2 / Build 81；不自动合并，不触碰签名密钥。

本次修改见根目录 CHANGELOG.md 的 Build 81 条目。系统红绿灯没有公开的任意坐标定位接口；使用 Apple 的垂直安全布局区域，消除应用额外占位与坐标重复计算，不伪造系统按钮或将交互内容放进遮挡区。

代码验证分为：JS/TS 语法与布局契约、持久缓存行为、完整 TypeScript、真实 iOS 模拟器流式播放及独立进程离线重启、iPad 横竖屏和 iPhone 的生产视图截图、设备 Release Archive。模拟器截图不是实体 iPad 浮动窗口操作测试；不将两者混淆。

交付文件由 `.github/workflows/ios-ipa.yml` 生成：`ios-ipa-v1.8.2-build81-unsigned` 与 `xcode-archive-v1.8.2-build81`。是否构建成功、实际 SHA-256 及文件是否可取回，需读取对应 Actions 结果后记录；本文件不预填成功结论。

官方参考：https://developer.apple.com/videos/play/wwdc2025/282/ （布局区域与系统窗口控件适配）
