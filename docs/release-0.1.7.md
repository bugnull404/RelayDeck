# RelayDeck 0.1.7

0.1.7 集中修复 Relay 连接与配对链路，并把当前 Android 界面和连接方式随版本统一发布。

RelayDeck 仍然是远程 Codex 客户端。它创建的 Codex 本地对话保存在本机 Codex app-server 中，**不是普通 ChatGPT Chat**，不会出现在 ChatGPT 网页或 App 历史中。

## Relay 修复

- 保存过的外部 Relay 配置可以在后台重启后正确恢复，不再把规范化配置误判为空地址。
- Relay 注册密钥会去除 BOM、首尾空格和换行；不会把粘贴时的隐藏字符带进鉴权计算。
- 从本机 Relay 切换到 VPS Relay，或更换 Relay 地址时，必须重新填写新 Relay 的注册密钥，不再静默沿用旧服务器密钥。
- 服务端返回 `unauthorized` 时停止无意义重连，并明确提示注册密钥与 Relay 服务端不一致。
- 只有 Relay 实际进入 `online` 后才允许签发配对 ticket；不会再出现显示 `connecting` 却提示“Relay 尚未连接”的含糊状态。
- 修复 Relay 机器公钥导出与保存公钥校验，避免有效身份被误判为公私钥不匹配。

## Android

- 配对页提供 **直连 / EasyTier / Relay** 三种互斥连接方式。
- 选择 Relay 后显示专用扫码、粘贴和连接设置，不显示普通局域网配对卡，也不会启动 EasyTier VPN。
- Relay 注册密钥只保存在电脑端；手机只接收一次性 ticket、机器公钥和首次配对后换取的长期设备凭据。
- 主界面提供“聊天 / 工作”分区：Chat 不提供模型选择，只允许低、中、高思考强度；工作分区保留完整模型、速度和排队设置。
- 侧边栏、输入框、按钮、会话气泡和设置页继续使用当前浅色圆角视觉，并移除设置页重复的整块背景入口。

## 安装

- **Android**：安装 `relaydeck-0.1.7.apk`。要求 Android 9 或更新版本、ARM64。覆盖安装前请确认旧版由同一调试签名构建。
- **Windows**：下载并完整解压 `relaydeck-desktop-0.1.7.zip`，运行根目录的 `install-desktop-plugin.ps1`。覆盖安装会保留现有 RelayDeck 配置与配对数据。

## 验证

- Node、Relay、Gateway、桌面管理与本地 Codex 对话测试全部通过。
- Android APK 与 JVM 状态测试将在本版本发布工作流中重新构建。
- 公网 Relay 已实际验证从 `unauthorized` 修复为 `online`、`connected: true`，并成功签发配对 ticket。
- 不同手机型号、不同运营商和 frp 线路仍需按实际网络单独验收。

RelayDeck 是独立维护的非官方项目，与 Codex LAN Remote 不是同一项目。

<!-- relaydeck-update: {"minDesktopVersion":"0.1.7"} -->
