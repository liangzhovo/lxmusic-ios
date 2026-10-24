<p align="center"><a href="https://github.com/liangzhovo/lxmusic-ios"><img width="200" src="https://github.com/lyswhut/lx-music-mobile/raw/master/doc/images/icon.png" alt="lx-music logo"></a></p>

<h1 align="center">LX Music · iOS 移植版</h1>

<p align="center">
  <a href="https://github.com/liangzhovo/lxmusic-ios/actions/workflows/ios-ipa.yml"><img src="https://github.com/liangzhovo/lxmusic-ios/actions/workflows/ios-ipa.yml/badge.svg" alt="Build iOS IPA"></a>
  <img src="https://img.shields.io/badge/RN-0.73.11-blue" alt="React Native 0.73.11">
  <img src="https://img.shields.io/badge/license-Apache--2.0-green" alt="Apache-2.0">
</p>

<p align="center">洛雪音乐助手（LX Music）移动版的 <b>iOS 移植</b>，基于 <a href="https://github.com/Q-1515/lx-music-mobile">Q-1515/lx-music-mobile</a> 的 ios-adaptation 分支二次开发。</p>

---

## 说明

- **上游官方并不支持 iOS**（lyswhut 明确表示"目前没有计划支持 iOS 和 HarmonyOS NEXT"），本项目是社区移植 + 二次增强，仅供技术学习与个人使用。
- 项目基于 [React Native](https://reactnative.dev) 0.73 开发，技术栈与上游完全一致，可自行编译。
- 软件本身**不提供任何内置音乐源**（2023-10 起已按上游要求移除全部内置源），在线搜索/试听/下载需要使用**自定义音源**（见下文）。

## 本项目新增特性

相对上游（及 Q-1515 iOS 移植版）新增：

| 特性 | 说明 |
|---|---|
| 🌗 **跟随系统亮暗模式** | 修复 iOS 上"跟随系统亮、暗模式切换主题"开关被静默禁用的问题（原代码对 iOS 恒返回不支持），现在 iOS 可实时跟随系统深/浅色 |
| ⬇️ **下载功能** | 下载管理页（下载中/失败/完成分类、重试、删除、全部暂停/开始、清除记录）、歌词/封面随歌曲一并保存、支持导出 ZIP |
| 📥 **歌单内下载** | 我的列表（歌单）歌曲菜单新增"下载"项（本地音乐自动置灰），多选模式支持批量下载 |
| 🎧 **本地优先播放** | 播放歌曲时**优先使用已下载的本地文件，无需联网**；本地无该歌曲时才请求网络链接 |
| 🏷️ **已下载标识** | 我的列表里已下载完成的歌曲显示小下载图标，状态实时更新 |

其余继承上游完整功能：搜索（聚合/单源）、歌单、排行榜、评论、歌词（翻译/罗马音/逐字）、桌面歌词、数据同步、主题与字体、备份恢复、自定义源等。

## 获取安装包

iOS 安装包由 [GitHub Actions](https://github.com/liangzhovo/lxmusic-ios/actions) 自动构建（macOS runner），产物为**未签名 IPA**：

1. 打开仓库 **Actions** 页面，选择最新一次 **Build iOS IPA** 工作流
2. 在 Artifacts 中下载 `ios-ipa-v1.8.2-unsigned`
3. **自行签名后安装**（任意签名方案均可，例如 AltStore / 爱思助手 / 个人开发者证书）

> 由于未上架 App Store，需要自签；免费 Apple ID 签名有效期 7 天，需定期续签。

## 本地开发构建

环境要求：Node 18+、JDK 17+、Android SDK（可选，仅调试 Android）、macOS + Xcode（构建 iOS 必需）。

```bash
git clone https://github.com/liangzhovo/lxmusic-ios.git
cd lxmusic-ios
npm ci                     # 安装依赖（含 postinstall 对 RNTP 的 iOS 补丁）
```

- **iOS**：`cd ios && bundle exec pod install`，然后用 Xcode 打开 `ios/LxMusicMobile.xcworkspace` 构建
- **Android（仅调试 UI）**：`npm run dev`
- **代码检查**：`npx eslint .`、`npx tsc --noEmit`

CI 构建流程见 [.github/workflows/ios-ipa.yml](.github/workflows/ios-ipa.yml)（npm ci → pod install（构建 vendored LXLibFLAC + SwiftAudioEx 补丁）→ xcodebuild 免签名 → 打包 unsigned IPA）。

## 关于自定义音源

本软件无内置音源。使用在线功能（搜索/试听/下载）前，需要先在 **设置 → 基本设置 → 自定义源** 导入音源脚本（搜索社区维护的 LX 音源 `.js` 文件）。移动端自定义源运行环境与桌面端不同，部分 API 不可用，请以移动端说明为准。

## 数据库与存储

- 下载文件保存于 App 文档目录 `lx-music-downloads/`（音频 + 同名 `.lrc` 歌词 + 封面图）
- 下载任务列表持久化于 AsyncStorage，重启后自动恢复并继续等待中的任务

## 免责声明

本项目基于 [Apache License 2.0](LICENSE) 发布，并延续上游补充协议（数据来源、版权数据、使用限制等，详见上游 README）。软件**完全免费、无广告**，仅供对新技术的学习与研究；请勿在违反当地法律法规的场景下使用，请在 24 小时内清除使用过程中产生的版权数据。

## 致谢

- 上游：[@lyswhut/lx-music-mobile](https://github.com/lyswhut/lx-music-mobile)（Apache-2.0）
- iOS 移植：[@Q-1515/lx-music-mobile](https://github.com/Q-1515/lx-music-mobile)（ios-adaptation 分支）
- 下载功能参考：[@littckerQiu/lx-music-ios-download](https://github.com/littckerQiu/lx-music-ios-download)