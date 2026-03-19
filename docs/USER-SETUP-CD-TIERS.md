# 环境隔离设置指南 (Dev / Beta Tiers)

> 这份文档说明了你需要手动完成的步骤，让 AI agent 开发不再干扰你日常使用的服务。

## 背景

目前的问题：AI agent（Claude Code、Codex）在开发过程中会重启本地服务（control-plane、worker、web），导致你正在使用的环境中断。

解决方案：把环境分成多个"层"（tier），各自使用不同的端口和数据库：

| 层 | 用途 | 端口 | 数据库 |
|----|------|------|--------|
| **beta** | 你日常使用 | 8080 / 9000 / 5173 | `agentctl` |
| **dev-1** | Agent 开发用 | 8180 / 9100 / 5273 | `agentctl_dev1` |
| **dev-2** | Agent 开发用 | 8280 / 9200 / 5373 | `agentctl_dev2` |

Beta 层由 PM2 托管，自动重启，不受 dev 层影响。Dev 层是临时的，用完即弃。

原则很简单：
- 日常开发、调试、agent 运行只在 `dev-1` / `dev-2`
- `beta` 只接收显式的 promote，不作为开发 tier 使用
- 远程 `promote-beta.yml` 仍然走 `beta` environment 审批门控

---

## 你需要做的事

### 1. 创建 Dev 数据库（一次性，2分钟）

```bash
psql -p 5433 -c "CREATE DATABASE agentctl_dev1;"
psql -p 5433 -c "CREATE DATABASE agentctl_dev2;"
```

### 2. 检查 `.env.beta` 文件（一次性，5分钟）

我们会从当前的 `.env` 生成 `.env.beta`。生成后请检查一下是否所有配置项（API key、数据库连接等）都正确。

### 3. 安装 PM2（如果还没装）

```bash
npm install -g pm2
```

### 4. 启动 Beta 层

```bash
# 首次启动
pm2 start infra/pm2/ecosystem.beta.config.cjs
pm2 save     # 保存进程列表，重启后自动恢复
pm2 startup  # 设置开机自启（按提示执行输出的命令）
```

### 5. 日常使用

**你的习惯完全不变：**
- 浏览器打开 `http://localhost:5173` — 这是 beta 层
- API 在 `http://localhost:8080` — 和以前一样

**Agent 开发时：**
- Agent 自动使用 `dev-1` 或 `dev-2` — 你不需要关心
- 不要直接在 `beta` 上开发；`beta` 只用于已批准的 promote
- 如果你想看 agent 的开发版本：打开 `http://localhost:5273`（`dev-1`）

**代码合并后升级 beta：**
```bash
# 先看计划，不执行
./scripts/env-promote.sh --from dev-1 --dry-run

# 显式把某个 dev tier 提升到 beta
./scripts/env-promote.sh --from dev-1
# 或
./scripts/env-promote.sh --from dev-2
```
`env-promote.sh` 的实际 CLI 形式是 `./scripts/env-promote.sh [--from <tier>] [--dry-run]`。脚本在本地支持省略 `--from` 时从 `.env.dev-*` 自动探测，但手动 promote 时请始终显式传 `--from dev-1` 或 `--from dev-2`，避免把错误的源 tier 提升到 `beta`。

这个命令会：构建最新代码 → 检查 schema parity → 迁移 beta 数据库 → 重启 PM2 进程 → 验证健康检查

---

## 常用命令

```bash
# 查看 beta 层状态
pm2 status

# 查看 beta 日志
pm2 logs agentctl-cp-beta
pm2 logs agentctl-worker-beta

# 重启 beta 层
pm2 restart all

# 手动启动一个 dev 层（通常由 agent 自动完成）
./scripts/env-up.sh dev-1

# 停止一个 dev 层
./scripts/env-down.sh dev-1
```

---

## 未来：远程部署

当我们准备部署到云端时：
1. 在目标机器上安装 GitHub Actions self-hosted runner
2. 启用 `promote-beta.yml` workflow（手动运行时必须显式选择 `dev-1` 或 `dev-2` 作为 source tier）
3. 在 GitHub 仓库设置里添加 `beta` environment（带审批门控，保持不变）
4. Prod 层用同样的模式，但部署到远程机器（通过 Tailscale）

这些步骤到时候再做，现在不需要。

---

## FAQ

**Q: Beta 层会因为 agent 开发而中断吗？**
A: 不会。Beta 层运行在 PM2 托管的构建产物上，dev 层使用不同的端口和数据库。

**Q: 如果 agent 崩溃了，dev 层会残留吗？**
A: 可能会。用 `./scripts/env-down.sh dev-1` 清理，或者 `pm2 delete` 清理对应进程。

**Q: 多个 agent 可以同时开发吗？**
A: 可以。dev-1 和 dev-2 完全独立。如果需要更多，加 dev-3（端口 +300）。

**Q: 数据库数据会互相影响吗？**
A: 不会。每个层有自己的 PostgreSQL 数据库。Beta 的数据安全。
