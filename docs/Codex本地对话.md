# RelayDeck Codex 本地对话

RelayDeck 现在支持由手机创建一种独立的对话式 Codex thread。它使用公开的 Codex app-server 协议，在电脑上持久化保存，可由手机和电脑继续查看。

## 它是什么

```text
RelayDeck 聊天界面
  -> Codex app-server
  -> 本机持久 Codex thread
```

- 会话执行在 `thread/start` 创建的真实本地 thread 上。
- 发送使用 `turn/start`，执行中追加使用 `turn/steer`，停止使用 `turn/interrupt`。
- 读取历史使用 `thread/turns/list`，恢复使用 `thread/resume`。
- 审批和用户问题走 app-server 的公开请求。
- 使用电脑已有 Codex 登录与套餐额度，不需要把令牌复制给手机。

## 它不是什么

它 **不是普通 ChatGPT Chat 的原会话**，也不会出现在 ChatGPT 网页或 App 的历史里。

公开 app-server 没有列写普通 ChatGPT Chat 的接口。RelayDeck 不读取 cookie/令牌、不抓网页 DOM、不调用私有 backend，也不会把桌面内部协议当成稳定 API。

因此：

```text
聊天样式运行 = 可以
保存在 Codex 本机 thread = 可以
出现在 ChatGPT 历史 = 不可以
同步 ChatGPT 原 Chat = 不可以
```

## 使用条件

1. Windows 已安装并登录 Codex。
2. RelayDeck Desktop 已启动，设置中开启“允许已配对手机主动选择本机聊天”。
3. 至少有一个已有 Codex 工作会话作为项目目录来源。
4. 手机和电脑已完成配对。

## 操作

1. 在手机会话列表选择 `Codex 对话` 分组旁的 `+`，或点顶部的 `+`。
2. RelayDeck 使用所选会话的工作目录创建一个新的本地 Codex thread。
3. 手机进入新对话，发送第一条消息。
4. 任务执行中再发消息会使用“立即插话”，不支持桌面工作会话的排队队列。
5. 审批、用户问题和停止按钮沿用现有聊天 UI。

## 安全与并发

- 新 thread 只由 RelayDeck 的 app-server 通道写入。
- 如果该 thread 正在电脑端被使用，写入会返回明确的冲突错误，不会强制抢占 Codex writer lock。
- 本地登记文件仅保存 thread ID、标题、工作目录、分组和模型设置；不保存消息正文、Cookie、JWT 或账号令牌。
- 手机不能传入任意绝对路径，只能选择目录列表中已有会话作为项目来源。

## 验证边界

自动测试使用假 app-server，覆盖创建、流式输出、历史、恢复、追加、停止、审批、用户问题和断线。

对安装版 Codex 的真实 app-server 可执行：

```powershell
node .\scripts\verify-interfaces.mjs --codex "<Codex 桌面程序路径>"
node .\scripts\verify-local-chat.mjs --codex "<Codex 桌面程序路径>"
```

`verify-local-chat.mjs` 会在系统临时目录创建一个标题为 `RelayDeck verification (temporary)` 的持久测试 thread，发送一句固定文本，并验证流式事件、历史写入和 `thread/resume`。它不会修改已有会话，但公开 app-server 没有 `thread/delete`，所以测试 thread 需要稍后从 Codex 桌面列表中手工删除。

真机、锁屏通知、公网 Relay/VPS 与跨运营商链路仍需另行验收。
