# RelayDeck 0.1.2

0.1.2 修复了 Android 手机端 Relay 连接方式被 EasyTier 界面覆盖的问题。

## 安装

- **Android**：下载 `relaydeck-0.1.2.apk`。要求 Android 9+、ARM64。
- **Windows**：下载并完整解压 `relaydeck-desktop-0.1.2.zip`，运行根目录的 `install-desktop-plugin.ps1`。

## 修复

- 手机连接页选中 **Relay** 后不再显示 EasyTier 配置入口，也不会启动或切换到 EasyTier。
- 已配对手机的连接方式切换不再把 Relay 当作 EasyTier 处理，不再申请 VPN 权限或等待虚拟网卡。
- 保持 Relay、EasyTier 和局域网直连三种模式独立，避免保存的 `networkMode` 被错误覆盖。

## 验证

- Android Gradle 编译与 JVM 测试：76/76 通过。
- Node 测试：106/107 通过；唯一失败是当前受限 Windows 用户上下文无法执行 DPAPI，与本修复无关。
- APK 已按新的 `versionCode 3` 构建。

## 说明

RelayDeck 是独立维护的非官方项目，使用 Codex 桌面内部接口。真实公网 Relay、frp 和跨运营商网络仍需按部署文档单独验收。

## SHA-256

```text
A8B285ECE0193FC39683F8E4437515AB65459A8A5509F4F2233A912E881CDAF1  relaydeck-0.1.2.apk
0AC1436D1299067CC8D38C0C4010F703ADB7C39B4DFCFD11F54A30357501A9A6  relaydeck-desktop-0.1.2.zip
```

<!-- relaydeck-update: {"minDesktopVersion":"0.1.2"} -->
