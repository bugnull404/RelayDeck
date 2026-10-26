# RelayDeck 0.1.0

RelayDeck 的第一个独立版本，从包名、插件、数据目录、协议和发布资产开始使用统一命名空间。

## 安装

- **Android**：下载 `relaydeck-0.1.0.apk`。要求 Android 9+、ARM64。
- **Windows**：下载并完整解压 `relaydeck-desktop-0.1.0.zip`，运行根目录的 `install-desktop-plugin.ps1`。

## 包含

- Android 客户端与 Windows Codex 插件
- 局域网、已有组网、内置 EasyTier、Relay 和直连模式
- 一次性二维码配对、长期设备凭据和设备撤销
- P-256 ECDH + HKDF + AES-GCM 端到端 Relay 加密
- 本机 Relay、VPS Relay 和 frp 部署
- 会话同步、消息发送、排队、中断与审批
- 文件预览、离线语音、主题与额度小部件
- 可自行导入透明角色素材；点击桌面角色弹出额度气泡，发布包不内置第三方角色图片
- Windows 登录自启与后台恢复
- 桌面插件使用独立的本机管理端口 `127.0.0.1:29647`

## 说明

RelayDeck 是独立维护的非官方项目，使用 Codex 桌面内部接口，桌面升级后可能需要适配。Android 测试包使用本地调试签名；真实公网 Relay、frp 和跨运营商网络仍需按部署文档单独验收。

<!-- relaydeck-update: {"minDesktopVersion":"0.1.0"} -->

