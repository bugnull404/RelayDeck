# RelayDeck 0.1.5

0.1.5 将 Android 主界面、会话侧栏和设置页更新为 ChatGPT 风格的浅色原生界面，并接入由 RelayDeck 创建和维护的 Codex 本地对话。

这是保存在本机 Codex app-server 中的持久 thread，**不是普通 ChatGPT Chat**。它不会出现在 ChatGPT 网页或 App 历史中；公开 app-server 目前没有列写普通 ChatGPT Chat 的稳定接口。

## Android

- 首页改为 ChatGPT 风格的顶部菜单、圆形账户入口、“聊天 / 工作”分段切换和浮起输入栏。
- 侧栏按项目和最近会话分组，补齐文件夹、折叠箭头、会话数量和编辑入口。
- 设置页按“我的 RelayDeck”“账户与外观”“支持与设置”“本机”分组，保留 Relay、EasyTier、额度、语音、通知、角色素材、更新与清除配对功能。
- 手机可以创建并进入 Codex 本地对话，查看流式回复、历史、工具与审批，执行插话和中断。
- 连接方式、二维码配对、额度小部件和透明角色素材功能保持不变。
- 界面使用项目自绘图标与系统字体，不包含 OpenAI 官方位图、远程字体或官方客户端资源。

## Windows 电脑端

- 增加 Codex 本地对话 runtime，使用公开的 `thread/start`、`turn/start`、`turn/steer`、`turn/interrupt`、`thread/turns/list` 与 `thread/resume`。
- 新对话使用已有会话的项目目录，不接受手机传入任意绝对路径。
- 会话登记只保存 thread ID、标题、工作目录、分组和模型设置，不保存消息正文、Cookie、JWT 或账号令牌。
- 同一 thread 若正在电脑端使用，RelayDeck 返回明确的 writer 冲突，不强制抢占 Codex writer lock。
- 修复 Relay 与 Gateway 同端口切换、握手会话编号和受控流清理问题。
- 修复设置页在插件重装、后台重启或 Codex 重开面板后丢失临时授权的问题：每次入口使用一次性票据换取 HttpOnly `SameSite=Strict` 会话 Cookie，不再把管理员令牌保存在 `sessionStorage`；直接打开裸本机端口会显示明确的重新打开提示。

## 安装

- **Android**：安装 `relaydeck-0.1.5.apk`。要求 Android 9 或更新版本、ARM64。覆盖安装前请确认旧版由同一调试签名构建。
- **Windows**：下载并完整解压 `relaydeck-desktop-0.1.5.zip`，运行根目录的 `install-desktop-plugin.ps1`。覆盖安装会保留现有 RelayDeck 配置与配对数据。

## 验证

- Android APK 实际构建成功，JVM 测试 79/79 通过。
- Node 测试 121/121 通过。
- 设置入口一次性票据、HttpOnly 浏览器会话和裸地址拒绝均有回归测试，并通过安装后 MCP 入口实测。
- 发布元数据校验通过，桌面端与 Android 端版本均为 `0.1.5`，`versionCode 6`。
- Android 真机视觉验收、公网 Relay/VPS 和跨运营商网络仍需单独验收。

RelayDeck 是独立维护的非官方项目，与 Codex LAN Remote 不是同一项目。

<!-- relaydeck-update: {"minDesktopVersion":"0.1.5"} -->
