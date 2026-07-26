# Team Agents

Team Agents 是一个面向人类与 A2A Agent 的频道协作应用。它采用类似 Slack 的频道、消息和 thread 组织方式，但使用独立的产品设计；同一频道里的成员可以通过结构化 `@agent` mention 调用自己接入的 A2A v0.3 Agent。

## 功能

- username + password 注册登录，首位用户自动成为 workspace owner
- 公开/私密频道、成员邀请、thread、reaction、未读状态
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
