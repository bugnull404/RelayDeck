# RelayDeck 0.1.1

0.1.1 是 RelayDeck 第一个可发布的独立版本，修复了桌面端管理端口与旧项目冲突的问题，并加入可自行导入的角色素材。

## 安装

- **Android**：下载 `relaydeck-0.1.1.apk`。要求 Android 9+、ARM64。
- **Windows**：下载并完整解压 `relaydeck-desktop-0.1.1.zip`，运行根目录的 `install-desktop-plugin.ps1`。

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

## 修复

- 桌面设置后台不再使用旧项目的管理端口，可与旧项目同时运行。
- 角色素材更换、移除后会立即刷新桌面小部件。
- 角色小部件按实际尺寸加载位图，减少桌面启动器内存压力。

## 说明

RelayDeck 是独立维护的非官方项目，使用 Codex 桌面内部接口，桌面升级后可能需要适配。Android 测试包使用本地调试签名；真实公网 Relay、frp 和跨运营商网络仍需按部署文档单独验收。

<!-- relaydeck-update: {"minDesktopVersion":"0.1.1"} -->
