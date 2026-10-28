# RelayDeck 0.1.6

0.1.6 继续收敛 Android 端界面：主界面、会话侧栏、设置页和启动页统一为更接近移动网页端的轻量布局，并删除没有真实功能或重复跳转的入口。

RelayDeck 仍然是远程 Codex 客户端。它的 Codex 本地对话保存在本机 Codex app-server 中，**不是普通 ChatGPT Chat**，不会出现在 ChatGPT 网页或 App 历史中。

## Android

- 主界面移除没有独立页面行为的“聊天 / 工作”切换，改为“菜单 · RelayDeck · 新建对话”的网页式顶栏。
- 侧栏移除“图像、资料库、项目、Codex、定时任务、查看更多”等无动作或重复入口，只保留搜索、新对话、真实会话分组和设置。
- “新对话”会优先使用当前项目；存在多个项目时先选择项目；没有可用基础会话时给出明确提示，不再显示必然失败的入口。
- 设置页移除重复的“当前电脑”和“查看连接引导”，按连接、使用与外观、桌面组件与本机重新分组。
- 启动页改为浅色、简洁字标和短淡出动画，移除粒子、光晕和旋转圆环。
- 新安装默认使用明亮外观，主界面、侧栏、设置页和系统栏保持一致的浅色视觉。
- 保留现有 Relay、EasyTier、二维码配对、Codex 对话、模型选择、插话、中断、审批、语音、额度和桌面小部件功能。

## Windows 电脑端

- 本次不修改桌面 Relay、Gateway 和本地 Codex 对话协议；Windows 包随版本统一更新。
- 最低兼容的 Android 桌面端版本仍为 `0.1.5`。

## 安装

- **Android**：安装 `relaydeck-0.1.6.apk`。要求 Android 9 或更新版本、ARM64。覆盖安装前请确认旧版由同一调试签名构建。
- **Windows**：下载并完整解压 `relaydeck-desktop-0.1.6.zip`，运行根目录的 `install-desktop-plugin.ps1`。覆盖安装会保留现有 RelayDeck 配置与配对数据。

## 验证

- Android APK 实际构建成功，JVM 测试 79/79 通过。
- Node 与桌面端回归测试 122/122 通过。
- 发布元数据校验通过，桌面端与 Android 端版本均为 `0.1.6`，`versionCode 7`。
- 当前构建环境没有连接 Android 真机或模拟器，因此启动页和侧栏的真机像素级视觉验收仍需单独完成。
- 公网 Relay、VPS、frp 和跨运营商网络仍需按实际部署单独验收。

RelayDeck 是独立维护的非官方项目，与 Codex LAN Remote 不是同一项目。

<!-- relaydeck-update: {"minDesktopVersion":"0.1.5"} -->
