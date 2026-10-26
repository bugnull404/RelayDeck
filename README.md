# RelayDeck

RelayDeck 是一个独立的 Android + Windows 远程协作工具，用手机继续操作电脑里的 Codex：查看会话、发送任务、处理审批，并在任务完成或需要操作时收到提醒。

它由三个清晰分离的部分组成：

- **RelayDeck Mobile**：Android 客户端。
- **RelayDeck Desktop**：Windows 端 Codex 插件与后台服务。
- **RelayDeck Relay**：可选的自托管 WSS 中转服务，适合手机与电脑不在同一网络的场景。

RelayDeck 从 `0.1.0` 开始独立发布，当前版本为 `0.1.3`，拥有自己的包名、插件 ID、数据目录、升级配置和配对数据。

## 连接方式

| 方式 | 适用场景 | 说明 |
| --- | --- | --- |
| 局域网直连 | 手机和电脑在同一 Wi-Fi 或以太网 | 直接连接电脑的 HTTPS 网关 |
| 已有组网 | 已使用 EasyTier 或其他组网工具 | RelayDeck 不接管已有组网实例 |
| 内置 EasyTier | 希望由 RelayDeck 管理组网 | 插件和手机 App 导入同一套组网参数 |
| Relay | 手机和电脑不在同一网络，且不希望手机常驻 VPN | 两端主动连接同一个 Relay；支持本机 Relay、VPS Relay 与 frp |
| 直连模式 | 已有第三方安全隧道，能把手机请求送到电脑 | 适合 Tailscale、ZeroTier、frp 等外部方案 |

Relay 模式的链路是：

```text
Android --WSS--> Relay <--WSS-- Windows Agent --> 127.0.0.1:9443 HTTPS Gateway
```

Relay 只处理路由、密文和短生命周期票据。手机与电脑之间使用 P-256 ECDH、HKDF 和 AES-GCM 做端到端加密；Relay 注册密钥不会进入手机配对信息。

## 功能

- 会话列表、历史消息、工具调用与任务状态同步
- 新建会话、发送消息、追加指令、排队消息和中断任务
- 审批操作、问题卡片、完成与待处理通知
- 图片、文本、Markdown、PDF 与常用 Office 文件预览
- 本地离线中文语音输入
- 深色/明亮主题与日出日落自动切换
- 账户额度双环展示、Android 桌面额度小部件和点击弹出的额度气泡
- 可自行导入透明角色素材；桌面角色可直接点击打开额度气泡
- 局域网、已有组网、内置 EasyTier、Relay 与直连模式
- 一次性二维码配对、长期设备凭据、设备撤销
- 可选的 Windows 登录自启与后台恢复
- 自托管 Relay、VPS 部署与 frp 兼容

## 安装

### 1. 安装 Windows 插件

从本仓库的 Releases 下载最新的 `relaydeck-desktop-<版本>.zip`，完整解压到固定目录，然后在该目录运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install-desktop-plugin.ps1
```

安装器会：

- 注册本地 marketplace `relaydeck-local`
- 安装插件 `relaydeck-desktop`
- 创建桌面与开始菜单的 **RelayDeck 设置**入口
- 将数据放在 `%LOCALAPPDATA%\RelayDeck`
- 使用独立的 RelayDeck 数据目录和插件标识

首次安装需要联网补齐固定版本的 EasyTier 原生依赖。

### 2. 安装 Android App

从同一个 Release 下载 `relaydeck-<版本>.apk` 并安装。要求 Android 9 或更新版本、ARM64。

### 3. 配对

1. 在 Codex 右侧面板打开 **RelayDeck 设置**，或在开始菜单搜索 **RelayDeck 设置**。
2. 选择连接方式并点击 **保存并启用**。
3. 生成一次性配对二维码。
4. 在手机 App 中扫码，核对电脑信息后确认。
5. 连接成功后即可查看会话、发送任务和处理审批。

## 网络配置

### 局域网 / 已有组网

在电脑设置页选择电脑当前可达的私有 IPv4 地址与远控端口，手机连接同一个局域网或组网后扫码配对。

### 内置 EasyTier

填写网络名称、网络密钥、电脑虚拟 IPv4/前缀和组网节点。手机扫码时导入同一套参数并授予 Android VPN 权限。RelayDeck 只管理自己启动的 EasyTier 实例。

### Relay

- **本机 Relay**：插件在本机 `127.0.0.1:19647` 启动 Relay，并自动生成注册密钥。适合测试或通过 frp 暴露本机入口。
- **VPS Relay**：Relay 部署在 VPS 上，手机与电脑都连接 `wss://` 公网地址。
- **frp**：可以把本机 Relay 通过 frp TCP 或 HTTPS/vhost 暴露到公网；公网入口必须使用 TLS。

桌面插件自身的管理页面固定监听 `127.0.0.1:29647`，只供本机 Codex 浏览器面板和设置快捷方式使用，不随远控模式变化，也不能从局域网直接访问。

详细步骤见 [Relay 部署与 frp](docs/Relay-VPS与frp部署.md)。

### 直连模式

如果已有 Tailscale、ZeroTier、frp 或其他安全隧道，可以让手机通过该隧道访问电脑网关。直连模式不导入组网参数，也不依赖 Relay。

## 从源码构建

### 环境

- Windows 10/11 x64
- Node.js 24
- JDK 17
- Android SDK 35
- Gradle 8.9

### 测试与桌面插件

```powershell
npm ci
npm test
.\scripts\build-desktop-plugin.ps1
```

输出位于 `.local/releases/`。

### Android

```powershell
.\scripts\build-android.ps1 `
  -SdkPath "C:\Android\Sdk" `
  -JavaPath "C:\Java\jdk-17" `
  -GradlePath ".\android\gradlew.bat" `
  -UpdateRepo "你的GitHub用户名/relaydeck"
```

`-UpdateRepo` 可选。不填写时 App 不启用 GitHub 更新检查，也不会访问任何默认仓库。

输出为 `.local/releases/relaydeck-<版本>.apk`。

本机配置、签名文件、证书、Relay 注册密钥和构建产物都不应提交到仓库。

## 安全说明

- 配对二维码包含短期凭据；内置 EasyTier 二维码还包含组网密钥，只应向自己的手机展示。
- Relay 不应直接暴露明文 `ws://` 到公网。
- 生产环境应使用受信任证书的 `wss://`。
- 撤销设备后，该设备不能继续使用旧设备凭据。
- 非官方项目依赖 Codex 桌面内部接口，桌面升级后可能需要适配。

## 文档

- [桌面插件使用指南](docs/桌面插件使用指南.md)
- [Relay 部署与 frp](docs/Relay-VPS与frp部署.md)
- [架构与安全设计](docs/架构与安全设计.md)
- [开发与发布约定](docs/开发与发布约定.md)
- [Android 测试指南](docs/Android测试指南.md)
- [角色素材导入](docs/角色素材导入.md)
- [EasyTier 集成](docs/EasyTier参考.md)
- [接口验证](docs/接口验证.md)

## 角色素材

RelayDeck 不内置第三方角色图片。可以在 App 的 **设置 → 角色素材** 中导入自己拥有使用权的透明 PNG 或 WebP。导入的图片只保存在本机 App 私有目录；桌面小部件会显示角色，点击角色即可打开额度气泡。

兼容 GPT-Niang 的角色素材格式，例如 `gpt-dragon-niang-bust.png`，但 RelayDeck 的 APK、源码和 Release 均不分发该素材。素材授权与使用范围由用户自行确认。




