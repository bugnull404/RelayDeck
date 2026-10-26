# RelayDeck 0.1.3

0.1.3 修复了部分 Windows 电脑在首次启用连接时无法生成 HTTPS 证书的问题。

## 安装

- **Android**：下载 `relaydeck-0.1.3.apk`。要求 Android 9+、ARM64。
- **Windows**：下载并完整解压 `relaydeck-desktop-0.1.3.zip`，运行根目录的 `install-desktop-plugin.ps1`。

## 修复

- 不再使用会报告 `New-SelfSignedCertificateCommand` 运行时异常的 `New-SelfSignedCertificate`。
- 改用 .NET `CertificateRequest` 在内存中生成 RSA 3072 证书，并直接导出 PFX 和公开证书。
- 不需要管理员权限，不写入 Windows 个人证书存储，也不会留下临时证书。
- 保留 `localhost`、`relaydeck.local` 和 `127.0.0.1` 三个必需 SAN，证书有效期 5 年。

## 验证

- 已在本机复现旧错误，并通过新生成器完成实际 PFX、证书链和 Node TLS 加载验证。
- Node 测试：107/107 通过。
- 已补充证书 SAN、有效期和 HTTPS 监听回归检查。

## 说明

RelayDeck 是独立维护的非官方项目，使用 Codex 桌面内部接口。真实公网 Relay、frp 和跨运营商网络仍需按部署文档单独验收。

## SHA-256

```text
1CE2FF998FBC1E72E0B09ACE518396F2942B8E43812C4407FCDE72055941C3CB  relaydeck-0.1.3.apk
1AEB08624A9FB5B18C95B318F45073299D477E1B3DF93F8479A40CF4E3895290  relaydeck-desktop-0.1.3.zip
```

<!-- relaydeck-update: {"minDesktopVersion":"0.1.3"} -->
