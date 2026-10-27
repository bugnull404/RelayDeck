# 普通 ChatGPT Chat 同步验证

本文记录“普通 ChatGPT Chat 能否像 Codex 工作会话一样进入 RelayDeck”的验证边界。验证对象是当前安装版 Codex 桌面程序及其公开 app-server，不是浏览器自动化的替代结论，也不包含聊天正文、账号资料、令牌或机器路径。

## 结论

| 能力 | 结论 | 验证程度 |
| --- | --- | --- |
| ChatGPT Chat 界面收发消息 | 可以 | ChatGPT 产品自身的既有能力，不是 RelayDeck 接入 |
| 在公开 app-server 列出 Chat 原会话 | 不可以 | 当前安装版真实探测 |
| 通过公开 app-server 读取 Chat 原会话消息 | 没有公开方法 | 当前安装版 schema |
| 通过公开 app-server 向 Chat 原会话发送消息 | 没有公开方法 | 当前安装版 schema |
| 通过公开 app-server 实时同步 Chat 原会话 | 没有公开方法 | 当前安装版 schema |
| RelayDeck 同步 Chat 原会话 | 暂不支持 | 不调用私有令牌、DOM 或数据库 |
| RelayDeck 同步 Codex 工作会话 | 支持 | 仓库自动测试；真机链路需单独验收 |
| RelayDeck 新建 Codex 本地对话 | 支持 | app-server 自动测试；不是 ChatGPT 原 Chat |

**不是说 ChatGPT Chat 不能发消息，而是说 Codex 没有向第三方插件公开它的 Chat 原会话接口。** 因此不能用“网页里能收发”推导出“RelayDeck 能同步”。

## 四层边界

### 1. Chat 产品界面

普通 ChatGPT Chat 由 ChatGPT 云端管理。用户在 Chat 界面里可以查看历史、发送消息和接收回复，这属于 ChatGPT 产品功能。

### 2. 公开 Codex app-server

当前安装版为 `codex-cli 0.164.0-alpha.11.1`。只读验证确认：

- `initialize` 成功。
- `thread/list` 可以列出 Codex thread。
- 使用 schema 中全部公开来源后，目录仍只包含 Codex 的工作来源，没有普通 Chat 来源。
- `ClientRequest.json` 共 106 个公开请求方法，没有 `chat/*` 的列表、读取或发送方法。
- `thread/list`、`thread/read`、`thread/turns/list`、`thread/start`、`turn/start` 等方法是 Codex thread 与 turn 的协议，不是 ChatGPT 普通 Chat 的协议。
- `account/workspaceMessages/read` 只用于 workspace 消息，不能作为普通 Chat 同步接口。

### 3. 桌面内部实现

对安装版桌面资源做只读审计时，可以看到桌面内部存在带认证的 ChatGPT 会话目录调用。这只能说明桌面自身有该能力，不能说明：

- 它是公开或稳定的第三方插件 API；
- 它允许读取原会话的全部消息；
- 它允许第三方向原会话发送消息；
- 它能在桌面升级后保持兼容；
- 可以安全复用桌面持有的账号令牌。

RelayDeck 不把这条内部通道当作产品接口，也不通过它复制令牌、调用私有后端或抓取网页 DOM。

### 4. RelayDeck 当前实现

RelayDeck 的目录来自 Codex app-server 的 `thread/list`，消息读取和实时事件来自 Codex 工作会话。`Chat 引用` 只是说明某个 ChatGPT 对话被引用进 Codex 后形成了工作 thread，不能把它当作 Chat 原会话。

RelayDeck 还新增了“Codex 本地对话”：通过 `thread/start`、`turn/start`、`turn/steer` 和 `thread/turns/list` 管理 RelayDeck 自己创建的持久本地 thread。它提供聊天式体验并可由手机同步，但依然不是 ChatGPT 普通 Chat，也不会出现在 ChatGPT 历史中。详见 [Codex本地对话](Codex本地对话.md)。

## 已完成的验证

- 使用当前安装版单独启动只读 app-server，完成初始化、会话目录和 schema 核对。
- 核对当前 schema 的全部请求方法与 `ThreadSourceKind`，未发现普通 Chat 原会话方法。
- 运行仓库自动测试：108 项中 107 项通过；唯一失败是当前沙箱无法调用 Windows DPAPI，与 Chat、发送或同步无关。
- 核对 RelayDeck 的目录、历史读取、工作会话发送、实时状态和 Relay 链路测试。这些测试针对 Codex thread，不能外推为普通 Chat。

本次尝试复验现有桌面本机 IPC 时，当前执行环境返回 `EPERM \\.\pipe\codex-ipc`，因此没有据此新增“当前桌面实时链路已复验”的结论。既有 IPC 验证记录与当前沙箱限制必须分开表述。

## 未完成与不能冒充完成的部分

- 没有向普通 Chat 原会话发送测试消息，因为没有公开发送接口。
- 没有读取普通 Chat 原会话正文，因为没有公开读取接口。
- 没有建立普通 Chat 原会话的实时订阅，因为没有公开订阅接口。
- 没有用当前账号的网页自动化或内部后端调用来代替 RelayDeck 集成验证。

如果后续需要继续，只有两种合规方向：

1. 等 OpenAI 提供公开、稳定的 Chat 列表、消息读写和订阅接口，再接入 RelayDeck。
2. 只同步 Codex 工作会话；这是当前已支持并有自动测试覆盖的范围。

不建议把桌面私有协议或网页自动化当成正式同步能力，因为它需要账号令牌、容易随桌面升级失效，也会扩大隐私与安全边界。
