# Relay、VPS 与 frp 部署

Relay 模式用于手机和 Windows 电脑不在同一局域网、也不想在手机上常驻 VPN 的场景。手机和电脑都主动连接同一个 Relay，连接建立后仍由电脑端验证手机授权。

```text
Android --WSS--> Relay <--WSS-- Windows Relay Agent --> 127.0.0.1:9443 HTTPS Gateway
```

Relay 只负责转发路由和 AES-GCM 密文，不保存 Codex 网关的 Bearer Token。电脑端在配对二维码中提供一次性 ticket 和机器公钥；手机首次连接后换取长期设备凭据。手机使用机器公钥指纹校验电脑，Relay 不能冒充已配对电脑。

## 三种可用拓扑

| 拓扑 | 适用场景 | 手机 Relay 地址 |
| --- | --- | --- |
| VPS 直连 | 有公网 VPS 和域名 | `wss://relay.example.com/v1/relay` |
| 本机 Relay + frp HTTPS | 没有 VPS，frp 服务商提供 HTTPS/WSS 域名 | 服务商分配的 `wss://域名/路径` |
| 本机 Relay + frp TCP + 公网 TLS | 有 VPS，frp 把本地 Relay 映射到 VPS | `wss://relay.example.com/v1/relay` |

只做 frp TCP 映射而不在公网侧终止 TLS 时，手机不能使用 `ws://`。本项目强制手机 Relay 地址为 `wss://`，请增加 HTTPS 反向代理，或改用 frp 的 HTTPS/vhost 隧道。

## 安全边界

- Relay 对外只应开放 HTTPS/WSS 的 `443`，Relay 本体监听 `127.0.0.1:19647`。
- 不要把 `19647`、frp 管理端口或 frp 的原始 TCP 映射端口直接暴露给公网。
- Relay 注册密钥只放在 Relay 配置和 Windows 用户 DPAPI 中；不要写入二维码、日志、截图或仓库。
- 手机地址必须是 `wss://`。反向代理必须保留 `/v1/relay` 路径和 WebSocket Upgrade。
- Relay 的 `relay-devices.local.json` 只保存设备凭据的 SHA-256 摘要，不保存明文凭据。
- 在电脑设置页撤销手机授权后，手机即使还能连接 Relay，也会被网关拒绝。需要清理 Relay 设备记录时，停止 Relay、删除对应摘要并重新启动。

## 方案一：VPS 部署 Relay

以下示例使用 Ubuntu/Debian、Node.js 24、Caddy 和域名 `relay.example.com`。

### 1. 安装程序

把仓库中的 `relay/`、`node_modules/ws/` 和 `package.json` 放到 `/opt/relaydeck-relay/`，或从发布源码目录复制。VPS 上不需要 Android SDK、Codex 桌面程序或 EasyTier。

```bash
sudo useradd --system --home /var/lib/relaydeck-relay --shell /usr/sbin/nologin relaydeck-relay
sudo install -d -o relaydeck-relay -g relaydeck-relay -m 700 /var/lib/relaydeck-relay
sudo install -d -o relaydeck-relay -g relaydeck-relay -m 755 /opt/relaydeck-relay
```

首次生成配置。`--public-url` 只用于运行状态展示，手机实际使用的地址由电脑设置页中的“RelayDeck Relay 的公网地址”决定。

```bash
sudo -u relaydeck-relay node /opt/relaydeck-relay/relay/main.mjs \
  --data /var/lib/relaydeck-relay \
  --host 127.0.0.1 \
  --port 19647 \
  --public-url wss://relay.example.com/v1/relay
```

确认 `/var/lib/relaydeck-relay/relay.local.json` 已生成，并把其中的 `registrationSecret` 填入 Windows 设置页。该文件权限应为 `600`，不要复制到手机或公开聊天。

### 2. systemd

创建 `/etc/systemd/system/relaydeck-relay.service`：

```ini
[Unit]
Description=RelayDeck Relay
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=relaydeck-relay
Group=relaydeck-relay
WorkingDirectory=/opt/relaydeck-relay
ExecStart=/usr/bin/node /opt/relaydeck-relay/relay/main.mjs --config /var/lib/relaydeck-relay/relay.local.json
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/relaydeck-relay

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now relaydeck-relay
sudo systemctl status relaydeck-relay
curl http://127.0.0.1:19647/health
```

### 3. Caddy 终止 TLS

`/etc/caddy/Caddyfile`：

```caddyfile
relay.example.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:19647
}
```

```bash
sudo systemctl reload caddy
```

Caddy 会自动处理证书和 WebSocket Upgrade。公网防火墙只开放 `80/443`；`19647` 保持只监听回环地址。

### 4. Windows 电脑设置

在“RelayDeck 设置”中选择 **Relay / 内网穿透**：

- 不勾选“由电脑插件启动本机 Relay”。
- 电脑连接 Relay 的地址填写 `wss://relay.example.com/v1/relay`。
- RelayDeck Relay 的公网地址填写同一个 `wss://relay.example.com/v1/relay`。
- 填写 VPS 配置文件中的 Relay 注册密钥。
- 保存并启用，再生成配对二维码。

手机扫码后会先连接 Relay，再用一次性 ticket 完成配对。之后重新连接使用长期设备凭据，不再依赖二维码 ticket。

## 方案二：本机 Relay

本机 Relay 适合先在 Windows 上验证完整链路，或让 frp 把本机 Relay 发布到公网。

在设置页勾选“由电脑插件启动本机 Relay”。电脑端 Relay 地址固定为：

```text
ws://127.0.0.1:19647/v1/relay
```

首次保存时插件会在 `%LOCALAPPDATA%\RelayDeck\relay\relay.local.json` 生成本机 Relay 配置和 64 字符注册密钥，并只把同一密钥的 DPAPI 密文写入 Windows 配置，不需要手动填写。若已有本机 Relay 配置，插件会沿用原密钥；手动填写不同密钥会被拒绝。

手机公网地址必须是 frp 或反向代理提供的 `wss://.../v1/relay`。本机 Relay 配置、设备摘要和注册密钥保存在 `%LOCALAPPDATA%\RelayDeck\relay\`，不会进入发布包。

如果手机和电脑只在本机回环环境测试，手机不能直接访问电脑的 `127.0.0.1`；必须通过同机反向代理、局域网地址或 frp 等可达入口连接。

## 方案三：frp 内网穿透

### frp HTTPS/vhost 隧道

适合没有 VPS、frp 服务商直接提供 HTTPS 域名和证书的场景。frpc 示例：

```toml
serverAddr = "frps.example.com"
serverPort = 7000
auth.method = "token"
auth.token = "frp-token"

[[proxies]]
name = "relaydeck-relay"
type = "https"
customDomains = ["relay.example.com"]
localIP = "127.0.0.1"
localPort = 19647
```

在服务商面板中选择 HTTPS 隧道，本地地址填 `127.0.0.1:19647`，公网域名使用面板分配的域名。手机地址填写：

```text
wss://relay.example.com/v1/relay
```

樱花 frp 的具体字段以面板和客户端版本为准；关键是本地端口、HTTPS 隧道、域名和 `/v1/relay` 路径保持正确。若服务商只给原始 TCP 端口，不要直接把该端口当 `wss://` 使用。

### frp TCP 隧道 + VPS Caddy

适合有 VPS、但希望 Relay 仍运行在 Windows 的场景。

VPS 的 `frps.toml` 示例：

```toml
bindAddr = "0.0.0.0"
bindPort = 7000
proxyBindAddr = "127.0.0.1"

auth.method = "token"
auth.token = "frp-token"
```

Windows 的 `frpc.toml` 示例：

```toml
serverAddr = "vps.example.com"
serverPort = 7000
auth.method = "token"
auth.token = "frp-token"

[[proxies]]
name = "relaydeck-relay"
type = "tcp"
localIP = "127.0.0.1"
localPort = 19647
remotePort = 29647
```

VPS 的 Caddy：

```caddyfile
relay.example.com {
    reverse_proxy 127.0.0.1:29647
}
```

`proxyBindAddr = "127.0.0.1"` 让 frps 的映射端口只在 VPS 回环地址监听，公网仍只通过 Caddy 的 `443` 进入。Windows 设置中：

- 勾选本机 Relay。
- 电脑地址使用 `ws://127.0.0.1:19647/v1/relay`。
- 手机公网地址填写 `wss://relay.example.com/v1/relay`。
- 首次保存会自动生成 Relay 注册密钥；后续保存沿用该密钥。

### frp 管理面

- frps 管理面板不要与 Relay 共用公开端口。
- `auth.token`、Relay 注册密钥和手机设备凭据都不要放进仓库。
- frp 只负责把流量送到 Relay；Relay 的 ECDH + AES-GCM 会话仍在手机和电脑之间端到端建立。

## 切换与验收

从本机 Relay 迁移到 VPS 时，不需要重装手机 App，也不需要重新生成电脑机器身份：

1. 在 VPS 启动 Relay，取得新的注册密钥。
2. Windows 设置页关闭“由电脑插件启动本机 Relay”。
3. 电脑 Relay 地址和手机公网地址都改为 VPS 的 `wss://.../v1/relay`。
4. 保存并启用，然后重新生成配对二维码。

Relay 注册密钥变化后，已经保存的长期设备凭据仍由 Relay 设备摘要校验；如果同时更换 Relay 数据目录，需要重新配对手机。

自动验收：

```bash
node --test --test-timeout=15000 tests/relay-protocol.test.mjs tests/relay-server.test.mjs tests/relay-agent.test.mjs
```

真实公网验收还应检查：

- 手机在移动网络下能打开 `wss://.../v1/relay`。
- 电脑关闭再打开后，Agent 自动重连 Relay。
- 手机断网再恢复后，使用长期设备凭据重连。
- VPS 只开放 `443`，`19647` 和 frp 原始端口未暴露。
- 撤销手机授权后，旧手机无法继续读取聊天。




