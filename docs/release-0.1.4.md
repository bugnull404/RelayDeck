# RelayDeck 0.1.4

## Android

- 在首次连接页选择 Relay 后，只显示 Relay 配对界面，不再混入局域网 IP、证书指纹和配对码表单。
- Relay 页面支持扫码或粘贴电脑生成的 Relay 配对信息，并显示脱敏后的 Relay 地址、电脑身份与电脑证书指纹。
- 设置页新增“Relay 连接”入口，可查看当前 Relay、重新导入配对信息，或直接测试并使用已保存的 Relay 连接。
- 连接方式菜单会保留已配对的 Relay 选项；切回局域网后仍可再次选择 Relay。
- Relay 连接不会启动 EasyTier VPN。

## 安装

安装 `relaydeck-0.1.4.apk`。要求 Android 9 或更新版本、ARM64。

覆盖安装前请确认旧版由同一调试签名构建。

## SHA-256

```text
C1287B4506897F367AD2F08F153E3651A98CCEBC3370C60B396F663F8B4E98FD  relaydeck-0.1.4.apk
```
