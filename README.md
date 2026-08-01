# Team Agents

Team Agents 是一个面向人类与 A2A Agent 的频道协作应用。它采用类似 Slack 的频道、消息和 thread 组织方式，但使用独立的产品设计；同一频道里的成员可以通过结构化 `@agent` mention 调用自己接入的 A2A v0.3 Agent。

## 功能

- username + password 注册登录，首位用户自动成为 workspace owner
- 公开/私密频道、成员邀请、thread、reaction
- 打开频道即停在最新消息，流式输出自动跟随；向上翻阅时不会被拽回，改为提示「N 条新消息」
- 滚到顶部或点按钮加载更早的消息，加载时保持阅读位置不跳动
- 频道列表按最近活跃排序，未读计数与标签页标题实时同步，不必刷新页面
- 被 @ 的消息在频道里高亮，侧边栏用独立的 `@` 徽标与普通未读区分
- 在输入框里直接 @ 自己尚未加入本频道的 Agent，选中即入频道，不用绕去弹窗
- 运行中的 Agent 显示排队/执行、已用时长、重试次数和它自报的进度
- 「我的任务」跨频道列出你的运行，可直接前往、停止或重试；跑完弹提示，可选桌面通知
- 一条消息 @ 多个 Agent 时可选并行或接力，接力会把前面的答案交给后一个
- 粘贴 Agent Card / A2A base / RPC 地址即可自动发现 Agent，名称、职责与端点从 card 读取
- 每位用户独立配置 Agent 的 JSON-RPC 地址、Bearer token 与历史条数
- `message/stream` SSE、Task 状态、artifact 增量合并、`tasks/get` / `tasks/resubscribe`
- Agent 流式占位消息、失败重试、取消和 `input-required`
- 中文 / English 本机切换，桌面三栏与移动端抽屉

## 技术架构

- React 19 + TypeScript + vinext
- Cloudflare Worker + D1
- 每频道一个 `ChannelRoom` Durable Object，使用可休眠 WebSocket
- `AGENT_TASKS` Queue 与 dead-letter queue
- scrypt（N=32768、r=8、p=3）密码哈希，保留旧 PBKDF2 记录的安全兼容校验
- AES-256-GCM Agent token 加密；API 永不回显 token

主要目录：

```text
app/                 React 界面
worker/              Worker API、A2A、Durable Object、安全层
db/schema.ts         Drizzle D1 模型
drizzle/             D1 migrations
tests/               安全与 A2A 解析测试
```

## 本地开发

要求 Node.js `>=22.13.0`。

```bash
npm install
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
```

打开 `http://localhost:3000`。本地 Agent 可以使用 HTTP 地址；生产环境仅允许公共 HTTPS 地址。

## 连接 Agent

在 Agent 弹窗里粘贴下面任意一种地址，点「读取 Agent Card」，名称 / 职责 / RPC 端点会自动填好，只剩 Bearer token 需要手填：

- Agent Card：`https://api.manyfold.ai/api/a2a/agents/<agentId>/agent-card.json`
- A2A base：`https://api.manyfold.ai/api/a2a/agents/<agentId>`
- RPC 端点：`https://api.manyfold.ai/api/a2a/agents/<agentId>/rpc`

后两种会依次尝试 `<base>/.well-known/agent-card.json` 与 `<base>/agent-card.json`。Card 是公开资源，读取时不发送 token。没有 card 的 A2A server 仍可手填全部字段。

API 上等价于：

```bash
curl -X POST http://localhost:3000/api/agents \
  -H 'content-type: application/json' \
  -d '{"cardUrl":"https://api.manyfold.ai/api/a2a/agents/<agentId>/rpc","bearerToken":"<token>"}'
```

`cardUrl` 之外的字段都可省略：`name` / `description` 取自 card，`handle` 由名称派生并自动加 `-2`、`-3` 后缀避免冲突，`historyCount` 默认 20。显式传入的字段优先于 card。

保存时先用 `tasks/get` 探测一个随机 task id 来确认 token 被接受 —— A2A server 在分发方法前鉴权，所以 401/403 说明 token 无效，task-not-found 说明可用，**不消耗 Agent turn**。只有当 server 未实现 `tasks/get` 时才回退到真实的 `message/stream` 测试。

Manyfold 托管 Agent 需要先在 agent 详情页 A2A tab 打开 exposure 并铸 External client token；exposure 未开启时端点统一返回 404。

连接失败会返回可读的错误码而不是笼统的 500：`agent_card_unavailable`（读不到 card）、`agent_token_rejected`（端点回 401/403）、`agent_unreachable`（网络 / 5xx）。校验不通过时不写库。

## 编辑 Agent

Agent 卡片上的铅笔按钮可以改名称、handle、职责、端点、历史条数与 token。Token 留空表示沿用已存的凭证。

只有端点或 token 变化时才会 `config_version+1` 并清空各频道的 A2A `contextId` —— 一个 contextId 只属于某个端点 + 身份，换了就必须重开会话；改名或调历史条数则保留频道记忆。

```bash
curl -X PATCH http://localhost:3000/api/agents/<agentId> \
  -H 'content-type: application/json' \
  -d '{"description":"新的职责描述"}'
```

## 在频道里用 Agent

输入 `@` 时，菜单先列本频道的人和 Agent，最后一组是**你自己还没加入本频道的 Agent**；选中它会先发一次 add-to-channel 再把 handle 填进草稿，所以不必先去 Agent 弹窗绕一圈。只有 Agent 的所有者能把它加进频道，但加进来之后频道里任何成员都能 @ 它。

一条消息里 @ 了两个以上 Agent 时，输入框上方会出现模式选择：

- **并行**（默认，也是历史行为）：同时开跑，彼此看不到对方的回答。
- **接力**：按 @ 出现的先后依次执行，后一棒的 prompt 里会附上前面几棒的答案，并被告知自己是第几棒。

接力的交接规则：前一棒 `completed` 或 `failed` 都会继续交给下一棒（一个队友说自己没做成，也是有用的上下文）；前一棒被**取消**或停在 `input-required` 时，后面还没跑的都会被取消并写明原因，而不是永远排在队列里。

## 运行状态与通知

Agent 消息的状态行区分「排队中」和「运行中」，并显示已用时长、重试次数、接力第几棒，以及 Agent 通过 A2A `status.message` 自报的进度 —— 这段进度以前一旦有 artifact 就会被覆盖掉。

侧边栏的「我的任务」列出你触发的、或属于你的 Agent 的所有运行，跨频道可见，可以直接前往频道、停止或重试。运行结束时右下角弹提示；在账号设置里打开「桌面通知」后，切到别的标签页也会收到系统通知（权限只在你点开关时申请）。

`GET /api/bootstrap` 里的 `runs` 字段就是这份列表：进行中的运行，加上最近 10 分钟内结束的，客户端据此判断哪些是「你不在的时候跑完的」。

## 验证

```bash
npm run typecheck
npm test
npm run build
npm run check:worker
```

## GitHub Actions 部署

项目只通过 [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) 发布。push 到 `main` 或手动运行 workflow 后，会依次：

1. 执行 typecheck、lint、测试、生产依赖审计、构建和 Worker dry-run。
2. 幂等创建 `team-agents-db`、`team-agents-agent-tasks` 和 DLQ。
3. 写入真实 D1 ID、应用 migration、部署 Worker 和 Durable Object migration。
4. 从 GitHub Secrets 注入凭证加密与认证 HMAC 密钥。
5. 对 health、匿名 bootstrap 和 HTML shell 做生产 smoke test。

在 GitHub `production` environment 配置四个 secret：

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `CREDENTIALS_ENCRYPTION_KEY`（至少 32 个随机字符）
- `AUTH_HMAC_KEY`（至少 32 个随机字符，且与前者不同）

可选 environment variable `PRODUCTION_URL` 用于覆盖默认 smoke-test 地址 `https://team-agents.netmind-ai.workers.dev`。

`CREDENTIALS_ENCRYPTION_KEY` 轮换前需要重新加密已保存的 Agent token。
