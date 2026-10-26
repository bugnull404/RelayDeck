# RelayDeck Android 测试指南

## 构建要求

- Android 9+、ARM64
- JDK 17
- Gradle 8.9
- Android SDK 35

## 构建

```powershell
.\scripts\build-android.ps1 `
  -SdkPath "C:\Android\Sdk" `
  -JavaPath "C:\Java\jdk-17" `
  -GradlePath ".\android\gradlew.bat" `
  -UpdateRepo "你的GitHub用户名/relaydeck"
```

脚本会：

1. 准备固定版本的 EasyTier 原生库。
2. 编译 Android App。
3. 运行 JVM 状态测试。
4. 输出 `.local/releases/relaydeck-<版本>.apk`。

`-UpdateRepo` 是可选参数；省略后 App 禁用更新检查。

## 真机检查

- 扫码配对成功，配对二维码不能重复使用。
- 局域网、已有组网、内置 EasyTier、Relay 和直连模式均能连接。
- 断开网络后自动重连，不会重复发送未确认任务。
- 手机切换 Wi-Fi 或移动网络后仍能恢复。
- Relay 模式不要求 Android VPN 权限。
- EasyTier 模式授予 VPN 权限后能自动获取虚拟地址。
- 完成、审批、问题卡片通知在锁屏和亮屏时均可显示。
- 文件预览按需加载，退出后不保留未授权缓存。
- 额度小部件显示实时、缓存或离线状态；点击卡片可弹出额度气泡、刷新并返回完整 App。
- 撤销设备后旧凭据无法继续连接。

## 签名

本机构建使用 `.local/secrets/android-debug.keystore`。发布包签名文件不得提交到仓库。

覆盖安装必须使用同一签名；不同签名需要先卸载旧 App，这会删除本地数据。
