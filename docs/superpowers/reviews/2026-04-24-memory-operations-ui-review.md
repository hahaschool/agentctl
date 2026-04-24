# Memory Operations UI — 批判性评审 (一次性全量)

> **Reviewer:** Claude (Opus 4.7), 变态级严格模式
> **Date:** 2026-04-24
> **Artifacts reviewed:**
> - `docs/superpowers/specs/2026-04-24-memory-operations-ui-design.md` (405 行, commit 779d7e34)
> - `docs/superpowers/plans/2026-04-24-memory-operations-ui-plan.md` (3,146 行, commit 815f1c2c)
>
> **Verdict:** **不可按现状实施。** 存在 1 条致命架构级错误 + 若干阻塞级代码错误,需要重写 spec/plan 的关键段落后再进入实施。下面按严重度从高到低一次性给出所有问题,不留尾巴。

---

## 0. 评分总览

| 维度 | 评分 (10 分制) | 备注 |
|---|---|---|
| 对代码库现状的核验 | **2 / 10** | 多处凭空引用不存在的文件/方法名 |
| 架构自洽性 | **3 / 10** | 与现有 mesh 同步模型直接冲突,且隐含 LiteLLM 集成回归 |
| 向后兼容风险管理 | **2 / 10** | PR B 内含未隔离的 breaking change |
| Spec ↔ Plan 一致性 | **5 / 10** | 多处相互漂移,Open Questions 状态不同步 |
| 测试策略覆盖 | **4 / 10** | 核心路径 (19k 实数据、SSE 重连、mesh 拒绝) 仅 hand-wave |
| TDD 纪律 | **5 / 10** | PR A/B/D/E 严谨;PR C/F/G 从 task 级降为口号级 |
| 安全性 | **4 / 10** | 解密→取 last4 在热路径、审计日志未实作、密钥可能入日志 |
| 可执行性 / 复制可用性 | **3 / 10** | web 端模块命名、SettingsPage 命名、apiFetch 全错,复制即 500 |
| 运维 / 回滚 | **3 / 10** | 无 kill switch、无 DLQ、pg_notify payload 上限未考虑 |
| **综合推荐** | **REQUEST CHANGES (大改重发)** | |

---

## 1. 致命问题 (SHOWSTOPPER —— 不修掉不要开始)

### 1.1 架构级事实错误:`api_accounts` 是 local-only,不参与 mesh 同步

**证据:** `packages/control-plane/drizzle/0021_mesh_change_log.sql` 第 130 行注释
```
-- 4. Attach triggers to all 15 synced tables (no api_accounts — local-only)
```
该决策是显式的(注释直接说明),现有代码从未给 `api_accounts` 挂 `sync_capture_change` 触发器。

**Spec 冲突点:**
- Spec 第 110 行:「Mesh sync inherits automatically — `sync_capture_change()` already serializes the full row via `to_jsonb(NEW)`, so the new column flows to peers without code changes.」—— **完全错误。** `api_accounts` 上根本就没有 `sync_capture` 触发器,新增列不会流向任何 peer。
- Spec 第 322 行:「Mesh sync does NOT replicate the plaintext API key — only the encrypted blob + metadata. Peer decryption uses each machine's local key-wrap, same as existing runtime credentials.」—— **自相矛盾。** 如果每台机器用本地 key-wrap,那加密 blob 在别机上根本解密不出来,这正是当初决定 local-only 的原因。Spec 对这个设计约束完全无感知。
- Acceptance Criteria 第 395 行:「Mesh peers see the same provider list and job history.」—— 在当前架构下**不可能**成立;provider 不同步,可见的只有 job history。
- Risk 表 第 383 行「Mesh peer runs maintenance while local peer also runs it」—— 这个风险缓解完全跑偏:peer 机器连 provider 都看不到,根本启动不了 job;真正的风险是 **peer 机器看到了 job 行,但 `credential_id` 指向本机不存在的 `api_accounts.id`,FK 变悬空。**

**Plan 冲突点:**
- Task A1 的迁移在 `memory_ops_jobs` 上挂 `sync_capture`,但对 `api_accounts` 完全没有追加触发器。
- Task E5 的验收步骤用 `curl /api/memory/ops/jobs/<id>` 拿 `status='completed'` 验证 —— 只在单机 dev-1 上做,完全没有触及 mesh 语义。

**后果:**
1. `memory_ops_jobs` 行被同步到 peer 时,`credential_id (uuid) REFERENCES api_accounts(id) ON DELETE SET NULL` 将出现 peer 端 FK 违规(ON DELETE SET NULL 只在宿主机生效),导致 mesh 重放失败,触发 `sync_nodes_schema_ahead_rejection` 相近机制的退款。
2. 多机用户必须在每台机器各自配一遍 provider,而 UI 提示从未告知这点 —— 与 Spec 的「multi-machine fleet」核心卖点矛盾。

**修复方向 (二选一, Spec 必须明确选择其中之一):**
- **(A) 放弃「mesh-synced 凭证」叙事**:承认 provider 是 per-machine,删除 Spec 全部关于 mesh 同步 api_accounts 的表述,`memory_ops_jobs` 只同步元数据(省略 `credential_id`,或让 FK 可为 NULL 且不 mesh-sync 这一列),UI 要明确展示「此 provider 只在当前机器可用」。
- **(B) 真正让 `api_accounts` 进入 mesh**:这意味着要迁到集中式 KMS 或共享 encryption key,涉及另一个独立的设计决策,**肯定不是 v1 范畴**。

**评审结论:致命级。Spec 不整改此条,整个设计根基不成立,不允许进入 writing-plans。**

---

### 1.2 Plan 对现有代码库做了至少 5 个事实性假设错误,复制粘贴即报错

| # | Plan 引用 | 代码库现状 | 影响 |
|---|---|---|---|
| A | Task B1 将 `EmbeddingClient` URL 从 `${baseUrl}/v1/embeddings` 改为 `${baseUrl}/embeddings`,并声明「其他 caller 把 baseUrl 末尾加 `/v1`」 | 现存 caller 用 `process.env.LITELLM_URL` (通常是 `http://localhost:4000`,无 `/v1`);LiteLLM 的 OpenAI-兼容端点是 `/v1/embeddings`。 | **PR B 合并即打断 LiteLLM 代理下的 memory 相关能力(knowledge-maintenance/synthesis/memory-search/memory-injector/mem0-client 全部依赖),在本 PR 范围外引发回归。** 这是一个被埋进 PR B 的 silent breaking change,且 spec 根本没提。 |
| B | Task G1「Wrap the existing `knowledge-maintenance.ts::runConsolidation`」 | `packages/control-plane/src/memory/knowledge-maintenance.ts` 导出的是 `class KnowledgeMaintenance`,入口方法是 `async run(scope?)`,**不存在** `runConsolidation` 顶层函数。 | PR G Task G1 整段代码 import 即 fail。 |
| C | Plan 全程 import `apiFetch` from `./core` (Task C1/F1/F2) | `packages/web/src/lib/api/core.ts` 实际导出的是 `function request<T>(path, init)`;其它 api 客户端一律 `import { request } from './core'`,然后以 `api.*` barrel 提供类型化 wrapper。**没有 `apiFetch`。** | PR C、PR F 的所有 web 代码类型检查失败。 |
| D | Task C5 「Modify: `packages/web/src/views/settings/SettingsPage.tsx`」 | `packages/web/src/views/settings/` 目录下**没有 `SettingsPage.tsx`**;Settings shell 位于 `packages/web/src/views/SettingsView.tsx` + `views/settings/SettingsShell.tsx`。 | PR C 连文件路径都错,Task C5 无法执行。 |
| E | Task F8 列出 `MemoryGraphPage.tsx` + `MemoryConsolidationView.tsx` | 两者**均不存在**。现有 Memory 视图:`MemoryBrowserView`, `MemoryDashboardView`, `MemoryDrawersView`, `MemoryImportView`, `MemoryMaintenancePage`, `MemoryReportsView`, `MemoryScopeManagerView`, `MemorySynthesisPage`。Plan 连实际 8 个视图都没数清楚,漏了 5 个,提了 2 个不存在的。 | `<MissingEmbeddingAlert />` 挂载覆盖严重缺失,用户在 `/memory/dashboard` / `/memory/reports` / `/memory/scope` 依然看到「为空」却没有提示。 |

**评审结论:致命级。** Plan 大量代码是对一个**想象中**的代码库写的。必须先对当前代码做一轮 prefix read,再重写 Plan 所有文件引用。

---

## 2. 阻塞级问题 (Blocker —— 进入实施前必须答复/修复)

### 2.1 PR B 打包了未隔离的行为变更 —— URL 语义

Plan Task B1 Step 3 直接在 PR B 中修改 `EmbeddingClient.embedBatch` 的 URL 构造规则,并写了一句轻描淡写的:

> **this is a behaviour change. Ship the fix with a migration note in the PR body; no data is affected.**

这在项目 git-discipline 下**不可接受**,原因:
1. PR 大小准则是「一个逻辑单元」。URL 规则变更牵动所有已有 caller,属于另一个独立 PR。
2. 如果 LiteLLM 在测试环境未部署到 dev-1 端口,你在 dev-1 上 smoke test 根本发现不了回归。
3. CLAUDE.md 的 beta 合同说「Beta is sacred, always buildable, never broken by agent work」—— PR B 促使 beta 的 memory-search/synthesis/maintenance **全部静默退化**,合同即被打破。

**必须的修复:**
- 用**可选的 `pathSuffix` 构造参数**或**不同的 client constructor**隔离新旧行为,默认保持 `/v1/embeddings`。Gemini 的 base URL 改成 `https://generativelanguage.googleapis.com/v1beta/openai`,仍由客户端追加 `/v1/embeddings` —— 这条 URL 实际非法,所以 Gemini 的 base URL 就应是 `https://generativelanguage.googleapis.com/v1beta/openai/v1`(末尾加 /v1),让调用路径拼出来是 `…/v1beta/openai/v1/embeddings`。这才是 Google AI Studio 的 OpenAI-compat 端点真实形状。
- 任何 breaking change 必须放单独的 PR、单独的版本 bump(按 dev-flow 规则也必须走 minor),且需要在 PR 描述中列出所有受影响的 caller 用 grep 结果证明已修。

---

### 2.2 单活跃 provider 的并发保护是 TOCTOU 竞态

Spec 第 109 行:「the "single active provider per kind" invariant is enforced at the API layer, not via a partial unique index」

Plan Task B3 Step 3 的实现(`memory-providers.ts`):
```typescript
if (parsed.active) {
  await db.update(...).set({ isActive: false }).where(... kind='embedding' AND is_active=true);
}
const id = randomUUID();
const inserted = await db.insert(apiAccounts).values({ ..., isActive: parsed.active }).returning();
```

两条 SQL 之间没有事务。两个并发 `POST /providers {active:true}` 可以:
1. A 先 UPDATE 0 行(库空)
2. B 先 UPDATE 0 行(库空)
3. A INSERT 一行 active=true
4. B INSERT 一行 active=true

终态两行 `active=true`。由此 `resolveEmbeddingClient` 的 `LIMIT 1` 语义变得依赖 priority/created_at 顺序,行为不稳定。

**修复:**
- 要么加 **partial unique index**: `CREATE UNIQUE INDEX ON api_accounts (credential_kind) WHERE is_active = true;`(spec 主动拒绝了这个方案,必须反悔);
- 要么用 `db.transaction(async (tx) => { … })` 包两条 SQL。

Plan 从头到尾没有任何 transaction 的踪影,PATCH 里切换 active 也是先 UPDATE 他人、再 UPDATE 本行,同样竞态。

---

### 2.3 `pg_notify` 8KB payload 限制未考虑 —— SSE 潜在失败

Plan Task D2 中 `updateProgress` / `complete` / `fail` / `cancel` 全部只发送 `pg_notify('memory_ops_job', <id>)` —— 这部分 OK,payload 很小。但 Plan Task D4 的 SSE 流又说:

> 「Each event carries the full `MemoryOpsJob` snapshot」

如果 SSE 实现打算在收到 notify 后立即从 DB 再查一次 row 再发 frame,并且 `MemoryOpsJob.result` 包含大 jsonb(embedding-backfill 完成时可能附带 sample、失败堆栈、最后 200 条 log),Fastify 层同一条 SSE frame 可能 > 64KB,这对客户端 EventSource 没问题,但对中间的反向代理(nginx 默认 `proxy_buffer_size 8k`)会截断。

**Plan 并未指定 result 的最大大小,也未指定 log 的汇总策略(spec 说「last 200 log lines」但没规定每行长度)。** 这是操作事故点。

**必要补丁:**
- Spec 需要规定 `memory_ops_jobs.result jsonb` 的最大字节上限(比如 16KB),超出部分转档至 `memory_ops_job_artifacts` 表或 S3-like 存储。
- Log 每行硬截断 512 字符,200 行上限 = 100KB 等级,SSE frame 分片发送(heart beat 之间多个 frame)。

---

### 2.4 `memory_facts.content_model` 被彻底忽略 —— 跨 provider 切换污染向量空间

`packages/control-plane/drizzle/0010_add_memory_layer.sql` 第 24 行:
```sql
"content_model" text NOT NULL DEFAULT 'text-embedding-3-small'
```

每行 memory_fact 都记录了「embed 它时用的模型」。Spec/Plan 有两处漏洞:
1. Plan 的 `embedding-backfill` handler 只过滤 `WHERE embedding IS NULL`,不检查 `content_model`。用户若先用 OpenAI embed 了 19k 条,之后切 Gemini 再跑 backfill —— 新的 Gemini 向量只写未 embedded 的新 fact;**老的 OpenAI 向量依旧驻留,与 Gemini 向量共用同一个 HNSW 索引,cosine 相似度全乱。**
2. UPDATE 语句没有同步刷新 `content_model` 列。Plan:`UPDATE memory_facts SET embedding = $1 WHERE id = $2 AND embedding IS NULL`。 `content_model` 仍保留默认值 'text-embedding-3-small',即便用户用 Gemini embed 了。**数据集从此分不清哪个 fact 是哪个模型 embed 的。**

**必要修复:**
- UPDATE 必须同步写 `content_model = <provider.model>`。
- Spec 必须明确切换 provider 时的动作:要么全量 re-embed(加一个 `re-embed-all` 作业类型),要么禁止切换(UI 禁用)。
- `/memory/operations` 必须显示当前 DB 中 `content_model` 分布(比如「19226 facts: 100% text-embedding-3-small」),否则用户永远不会发现混模型污染。

---

### 2.5 成本追踪是假的

- Spec 多处保证「progress.costUsd」「jobs record cost and outcome」「Cost disclosure」。
- Plan Task E1 handler 的 `progress: MemoryOpsProgress = { done, total, costUsd: 0, errorCount };` —— **硬编码为 0**。
- Plan Task B4 POST /:id/test 的 costUsd 同样是 0 的 placeholder。

这意味着:
- Acceptance criterion「see `dim=1536, costUsd≈0.00000002`」**不可能被满足**。
- 「aggregates monthly totals as a transparency measure」(Security 节)**根本无数据**可聚合。

OpenAI/Gemini embedding 响应的 `usage.prompt_tokens` 是成本计算的必要输入,**`EmbeddingClient` 现在不返回 usage**,Plan Task B1 也没有扩展 `embedBatch` 的返回结构。这一条需要:
- Plan Task B1 扩展 `EmbeddingClient.embedBatch` 返回 `{ vectors, tokensUsed, modelEcho }`。
- Plan Task E1 累加 `progress.costUsd += tokensUsed / 1e6 * EMBEDDING_MODEL_CATALOG.find(...).priceUsdPerMtoken`。
- 增加单测:跑 3 个批次,断言 costUsd 单调上升且与 mock 的 `usage.prompt_tokens` 匹配。

---

### 2.6 Spec 所承诺的「401 时自动停用 provider」Plan 未实现

Spec 第 307 行:「Provider auth (401) mid-job | Job marked `failed`, provider row `is_active=false`, metadata `lastTestOk=false`.」

Plan Task E1 的实现:
```typescript
if (err instanceof Error && err.message.includes('401')) {
  throw err;
}
```
仅抛出,`runJobWithLifecycle` 只 `jobsRepo.fail(jobId, message)`,**从未 UPDATE api_accounts.is_active**。Acceptance 中承诺给操作员的「Rotate key」链接也无从触发。

另外,**用 `err.message.includes('401')` 判 401 是严重反模式**:
- EmbeddingClient 抛 `ControlPlaneError('EMBEDDING_API_ERROR', ...)`,message 里其实是类似 `"Embedding API returned 401: {...}"`,但未来改错误格式会静默断掉匹配。
- 如果上游错误 body 包含「401」字样(比如自定义中间件返回的 `"Retry not supported, see doc section 401"`),会误判。

**修复:**
- `ControlPlaneError.context.status = 401` 作为结构化字段传上来。
- Handler 用 `err.context?.status === 401` 判断。
- 判定为 401 → 调用 `providersRepo.deactivate(credentialId)` 且写入 `metadata.last_test_ok = false`。
- 配套单测。

---

### 2.7 `POST /:id/test` 的 nested `await db.select()` 是并发事故

Plan Task B4 Step 3:
```typescript
.set({
  metadata: {
    ...((await db.select().from(apiAccounts).where(eq(apiAccounts.id, req.params.id)))[0]?.metadata ?? {}),
    last_test_at: ...,
  },
})
.where(eq(apiAccounts.id, req.params.id));
```

这是「先读后写」的经典竞态:
1. 同一秒钟另一个 PATCH 把 `metadata.base_url` 改成了新值。
2. 这个 test handler 读到旧的 metadata,合并后写回 —— 新的 base_url 被无声盖掉。

再者,**把一个 `await db.select()` 写进对象 spread 本身就是极糟的可读性** —— biome 大概率会报 `sonarjs/no-nested-assignment` 或类似。

**修复:**
- 先 SELECT 到变量,再 UPDATE。
- 用 Postgres 的 `jsonb_set(metadata, '{last_test_at}', ...)` 原子更新子键,避免整行重写。
- 放进 transaction。

---

### 2.8 `DELETE /providers/:id` 在 PR B 阶段就放给操作员,但缺少「running job 拦截」

Plan Task B4 Step 3 DELETE 实现:
```typescript
app.delete<{Params:{id:string}}>('/:id', ..., async (req, reply) => {
  // PR D extends this handler with a "reject if any running job references this credential"
  // check once memory_ops_jobs exists. For now the unconditional delete is acceptable ...
  await db.delete(apiAccounts).where(...);
  return reply.code(204).send();
});
```

**这违反 Spec 的 Error Handling 第 309 行**「Delete provider with running jobs: 409 Conflict」。Plan 的借口「for now the unconditional delete is acceptable because no queue is running yet」是错的 ——
- PR B → 合并 → 走 dev-flow → **promote to beta**(按 Plan Task B6)。操作员一旦可以在 Settings 里删,就真的会删。
- PR D 还没合并,但 `memory_ops_jobs` 表此时已经有(PR A 已经建表)。即便 PR A 单独 promote 不会有行,**Plan 明确让 PR D 也在用这张表之前就 promote 一次 Skeleton(Task D5/D6 只有 CRUD 和 SSE,handler 在 PR E)**。PR D 之后可以 POST job 但没人处理 —— 操作员视角:UI 可删 provider,UI 也可排队 job,系统没法拦截。
- **最严重的:**PR B/D/F 都已先后 promote 到 beta,用户的 19k facts 还在等 PR E。此时用户点了 delete provider,beta 上无声地 cascade(SET NULL),下一次开 /memory/operations 所有 JobCard 的最近一次 job credential 都变 orphan,UI 无法显示 provider 标签。

**修复:**
- PR B 里**就要**实现 409 检查,即使 `memory_ops_jobs` 当时为空,SELECT COUNT 为 0 也只是空检查。等价工作量,避免 PR B/PR D 之间的时间窗漏洞。

---

### 2.9 性能灾难:embedding-backfill handler 每个 fact 一条 UPDATE

Plan Task E1 Step 3:
```typescript
for (let i = 0; i < page.rows.length; i += 1) {
  await pool.query(
    `UPDATE memory_facts SET embedding = $1 WHERE id = $2 AND embedding IS NULL`,
    [`[${vectors[i].join(',')}]`, page.rows[i].id],
  );
}
```

100 条 fact 一批 = **100 条 round-trip UPDATE**。假设 DB 延迟 1–2ms(本地),一批就是 100–200ms 纯 SQL 延迟,加上 OpenAI 的 ~300–800ms embed 延迟。19,226 条 = 193 批 × (~500ms embed + ~150ms DB) = **~125 秒理想值**,但真实世界加上 OpenAI rate-limit 和 retry,到 15 分钟是乐观估计。

Acceptance「embedded in ≤ 15 minutes」本身数字靠走运才能满足,并且 spec「cost for 19k facts is approximately $0.08 on OpenAI small」与 acceptance「≤ 15 min」在 N+1 update 的实现下边界非常紧。

**应该的实现 —— 一条 SQL 批量更新:**
```sql
UPDATE memory_facts AS f
SET    embedding = v.embedding::vector,
       content_model = $1
FROM   (SELECT * FROM jsonb_to_recordset($2::jsonb)
        AS x(id text, embedding text)) v
WHERE  f.id = v.id AND f.embedding IS NULL;
```
甚至直接用 `pg` 的 `copyFrom` + COPY 协议也可。**Plan 对此完全没讨论**,属于「能跑就行,性能不管」的 MVP 思维,但又在 acceptance 里写死「≤ 15 min」。两者不自洽。

---

### 2.10 `rowToProvider` 解密整个 DB 列表,仅为拿 last4

Plan Task B3 Step 3:
```typescript
function rowToProvider(row, encryptionKey) {
  let last4 = '****';
  try {
    const plaintext = decryptCredential(row.credential, row.credentialIv, encryptionKey);
    last4 = plaintext.length >= 4 ? plaintext.slice(-4) : '****';
  } catch {…}
  …
}
```
`GET /providers` 对每行 `rowToProvider` 一次 → **每次列表请求都在内存里把所有 API key 还原一次**。问题:
- 增加 key 暴露面(内存转储 / APM 抽样 / 调试器)。
- 并发 10 个 tab 在 Settings 页轮询 staleTime=30s → 每 30 秒解密一次。
- 一旦加密 key 本身被攻破,攻击者只要触发列表请求,就能拿到当前机器所有 runtime + embedding 凭证的明文。

**修复:**
- 新增 `api_accounts.credential_last4 text` 列,`POST`/`PATCH` 时由后端计算并持久化,`GET` 时直接读列。
- 或在 metadata 里存 last4(反正 metadata 已经存了其它解密无关数据)。

---

### 2.11 mesh 与 `memory_ops_jobs.id` 的类型不一致

- Plan 迁移:`id text PRIMARY KEY`
- Plan Task D2 `create()`:`const id = input.id ?? randomUUID();` → 插入的是 UUID 字符串
- Plan 迁移:`credential_id uuid REFERENCES api_accounts(id) ON DELETE SET NULL`

三者混用 text / uuid。`memory_ops_jobs.id` 为 text,在类型上可以接受 UUID 的字符串形式,但:
- `sync_capture_change('id')` 触发器把 text id 当同步 key 用,和其它同步表(多数用 uuid)的 key 不一致,潜在兼容隐患。
- 如果后续要给 `memory_ops_jobs` 加 child 表并 FK,FK 类型定不下来。

**修复:** 全部统一为 `uuid PRIMARY KEY DEFAULT gen_random_uuid()`。

---

## 3. 严重问题 (Critical —— 影响正确性/安全性)

### 3.1 Zod schema 反模式 —— `.transform()` 里 throw

Plan Task A3 `embeddingProviderSchema.transform((input) => { if (!catalog) throw new z.ZodError(...); …});`

Zod 的 `.transform()` 语义是「变形」,不该抛 —— 如果要报验证错应该用 `.refine(…)` 或 `.superRefine(…)` 产生 ZodIssue。Plan 里这个 schema 一旦被 `.partial()`(Task B4 PATCH 用到),`transform` 不会被保留,PATCH 侧根本得不到 `baseUrl/extraBody/dim` 的自动填入逻辑 —— **PATCH 行为与 POST 行为不对称,且用户无从察觉。**

**修复:**
```typescript
export const embeddingProviderSchema = z.object({…}).superRefine((val, ctx) => {
  const catalog = …;
  if (!catalog) ctx.addIssue({…});
});
// derive baseUrl/dim 放在应用层,不走 transform
```

---

### 3.2 Plan 的 Drizzle mock 链不符合真实库

Plan Task B3 Step 1:
```typescript
function makeDb(rows) {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => Promise.resolve(rows),
        }),
      }),
    }),
  };
}
```
Drizzle 的链式 API 是 PromiseLike 本身,调用 `.where()` 返回的对象即可 `await`,并非只有 `.orderBy()` 返回 Promise。`GET /` 没 orderBy 时会 `await app.db.select().from().where()`,但 mock 要求必须调 `.orderBy()` 才能得到 Promise —— **这种 mock 耦合于生产代码的具体调用链**,任何一次重构都会打穿测试。

类似 mocks 遍布 Plan (PATCH 测试里还嵌套 `{ update: () => ({ set: () => ({ where: () => ({ returning: () => Promise.resolve() }) }) }) }`) —— 每个动词路径不同,且不检测条件参数,**测试过不过只看 call-signature 结构完整,不检查 where/orderBy 是否正确**。达不到 Spec 承诺的「Mock external services at the boundary」。

**修复:** 用 `drizzle-orm/pg-core` 的 `PgliteDatabase` 或 `pg-mem` 起一个真实 PG 进程级别的测试,或者 wrap 一层 `JobsRepository` 让测试直接 mock 这个 repo 而不是 drizzle。

---

### 3.3 Plan Task B5 的集成测试断言 500 是错误

```typescript
expect(res.statusCode).toBe(500); // ZodError bubbles to 500 via the error handler
```
错误输入应返回 400/422,不是 500。Fastify 默认对 ZodError 不知道怎么处理,Plan 自定义的 `setErrorHandler` 把未知 err 转 500,连锁把用户输入错误误报为内部错误。Spec 第 305 行明确规定:「Provider test fails at creation: Save returns `422` with provider error body」。Plan 自行变 500 违 Spec。

---

### 3.4 审计日志承诺落空

Spec 第 320 行:「every provider create/update/delete and every job create/cancel emits a hash-chained entry via the existing `audit-logger.ts`, tagged `memory-ops`.」

Plan 从 PR A 到 PR G:**零次**调用 `audit-logger`。完全没有。
- 操作员删掉 provider,审计看不到。
- 操作员取消了正在跑的 job,审计看不到。
- 合规层面这是**回归**。

**必要补丁:** PR B 和 PR D 的路由实现里,每个写操作都要 `await auditLogger.append({ actor, action, target, tag: 'memory-ops' })`,带单测。

---

### 3.5 `POST /:id/test` 的 rate-limit 粒度错误

Spec 第 318 行:「rate-limited (5 req / min / account) to prevent key-fishing」—— 按 **account 维度**。
Plan Task B3 Step 3:`keyGenerator: (req) => req.ip ?? 'unknown'` —— 按 **IP 维度**。

结论:多个操作员在同一 VPN / NAT 后共用 IP,互相打满对方配额。**或者**攻击者用多 IP 轮换,完全绕过限速。语义违背 Spec。

**修复:** `keyGenerator` 改为 `(req) => `${req.ip}:${req.params.id}``;或对 `/:id/test` 用 per-credential-id bucket。

---

### 3.6 API key 有可能被日志污染

`EmbeddingClient.embedBatch` 在 401 时会:
```typescript
throw new ControlPlaneError(
  'EMBEDDING_API_ERROR',
  `Embedding API returned ${response.status}: ${errorBody}`,
  { url, model: this.model, status: response.status },
);
```
`errorBody` 来自 `await response.text()`。OpenAI 401 响应 body 是标准 JSON,不含 key 明文。但 Plan Task B1 让 `EmbeddingClient` 在 header 里写 `Authorization: Bearer <apiKey>`,**Fastify 或 undici 的 debug 日志在 stack trace / redacted 不当时可能把 header 或 `fetch` 的 request init 打出来**。Plan 没指导:
- `pino` 的 `redact` paths 要包含哪些(`req.headers.authorization`, `req.body.apiKey`, `req.params.apiKey`)。
- `logger.error(err)` 时 `err.context` 是否含 apiKey 派生字段。

项目 `.claude/rules/security.md` 第 6 条:「NEVER log full API keys or tokens — log only the last 4 characters」。Plan 全程没有落实这条。

---

### 3.7 mesh 同步 `memory_ops_jobs` 的 payload 风险

Plan 的 `sync_capture_change` 触发器捕获 `to_jsonb(NEW)`,即 row 全量。含 `progress`、`result`、`error`、`params`。

- `params` 可能含 `credentialId` (UUID) —— 未脱敏,但 UUID 本身不泄敏。
- `result` 没有上限控制(见 2.3)。
- `error` 可能含上游 API 错误文本(见 3.6 同样风险)。

同步 payload 经由 mesh change log → peer → INSERT 到 peer 机器的 `memory_ops_jobs`。**peer 机器的 `api_accounts` 是本地的**,credentialId 在 peer 上 orphan,但 error 文本若包含敏感信息,现在就跨机器扩散了。

**修复:** 同步前做 projection,Spec 没有规定 sync 包含哪些列。或在触发器写 payload 时 redact `error`、`result` 中的敏感子键。

---

### 3.8 worker 启动位置 / 进程模型未定义

Plan Task E3 说 `createMemoryOpsWorker` 在 `packages/control-plane/src/index.ts` 里 new 一个 `Worker`。问题:
- **单进程 Worker**:与 Fastify API 同进程同事件循环,embedding batch 长 HTTP 占用 libuv 线程池,API 响应延迟。Spec 「concurrency=1」反而坐实这个问题。
- **多 peer 机器**:mesh 同步让 macmini / EC2 / 笔记本都运行 Worker,**四台同时 pick up 同一个 queued job**,`JobsRepository.claim()` 的 UPDATE-WHERE-status='queued' 保证只有一台成功,其它返回 false。**但这是 per-DB 级保护**。如果各 peer 用不同 Postgres(Spec 没说 DB 是 mesh-synced 还是每台机器一份),集中 DB 假设未阐明。
- Plan 对 PM2 编排零提及。beta 的 `infra/pm2/ecosystem.beta.config.cjs` 是否新增 memory-ops-worker 进程?是走 `agentctl-control-plane-beta` 进程内嵌,还是起 `agentctl-memory-ops-beta`?Spec/Plan 都没答。

---

## 4. Spec ↔ Plan 漂移 (Coherence Drift)

| Spec 原文 | Plan 现状 | 结论 |
|---|---|---|
| `drizzle/0033a_api_accounts_credential_kind.sql` + `drizzle/0033b_memory_ops_jobs.sql` (两文件) | `0033_add_memory_ops.sql` (单文件) | Plan 没跟 Spec,至少其一该更新 |
| Provider 响应:`apiKeyLast4` / `dim` / `lastTestOk` (纯字段) | Plan 将 `last_test_at/ok/error` 存 metadata jsonb snake_case,列出时读 metadata | snake_case ↔ camelCase 混用,Response JSON 稳定性差 |
| Spec Open Questions 依然列在 Spec 里 (第 398-403) 注明「carry into writing-plans」 | Plan 首部已解答 4 个问题 | Spec 版本未同步删除或标注已解决 |
| Spec 第 296 行 MissingEmbeddingAlert 挂 6 页: maintenance/synthesis/consolidation/graph/browser/drawers | Plan Task F8 挂 5 页 + 括号标注 consolidation 可能不存在,graph 拼写也不对应实际 view | 覆盖缺失;实际视图层更多(见 1.2.E) |
| Spec:「Scheduled / cron maintenance runs. v1 is manual-trigger only」 | Plan 未提任何 cron,OK | OK |
| Spec 第 305 行:Test fail at creation 返回 422 | Plan Task B3/B4 从没实现 422 分支,Task B5 集成测试断言 500 | 违 Spec |
| Spec Acceptance:「Mesh peers see the same provider list and job history」 | Plan 连机器间切换都没测;且 api_accounts 不 mesh-sync | 不可能实现 |
| Spec:`costUsd ≈ 0.00000002` 测试探针 | Plan Task B4 的 `costUsd: 0` 硬编码 | 违 acceptance |
| Spec:`costUsd ≈ 0.08 on OpenAI small` for 19k | Plan Task E5 同数字作为 acceptance,但 handler 从不计算 cost | 数字永远对不上 |
| Spec:「mesh sync does NOT replicate the plaintext API key — only the encrypted blob + metadata」 | Plan 根本没让 api_accounts 进 mesh | 两者都是错的,Spec 错在底层假设,Plan 错在 spec 没同步更新 |

---

## 5. TDD / 测试策略问题

### 5.1 PR A/B/D/E 的 Task 严谨,但 PR C/F/G 从「完整 step 代码」降级为「Commit 命名」

对比 Task B1~B4(显式 `步骤 1~5` + fail → impl → pass → commit 循环)与 Task F2~F9:

```md
## Task F2: React Query hooks
**Files:** - Modify: ...
Add `useMemoryOpsJobs`, `useCreateMemoryOpsJob`, ...
Commit: `feat(web): add React Query hooks for memory-ops jobs`
```

F2 没有 failing test、没有 impl 代码示范、没有验收命令。**整个 PR F 和 PR G 的 task 定义实际无法被「executing-plans」skill 按计划驱动**。这违反 Plan 首部「every task writes a failing test first, watches it fail, implements the minimum, watches it pass」。

**结论:** PR F/G 等于没写。必须按 PR B 的详细度重写。

### 5.2 遗漏的关键测试

- 未写的核心 e2e:**mesh schema-ahead peer 拒绝 0033 迁移的行为**。
- 未写的核心 e2e:**运行 job 时 delete provider → 409**(Spec 明确要求)。
- 未写的核心 e2e:**SSE reconnect + Last-Event-Id 丢包补发**。
- 未写的核心 e2e:**auth-failure mid-job → provider 自动 is_active=false**。
- 未写的核心 e2e:**cancel mid-batch**。
- 未写的性能 e2e:**19k facts 实际完成时间**(acceptance 的 ≤ 15 min 断言无证据)。
- 未写的性能 e2e:**SSE 每 100 次/秒 progress 事件下的 payload 大小 + 客户端接收情况**。
- Playwright spec 使用 msw-node,但 msw-node 对 Node fetch 的拦截 v2 和 Node 20+ 的 undici 内置 fetch 有已知兼容问题;Plan 没提 msw 版本。

---

## 6. UI / UX 缺陷

1. **`<MissingEmbeddingAlert />`** 直接跳到 `/settings#memory-embeddings`,但 Plan Task C5 对 hash anchor 的实现只 hand wave「scroll anchor / section id」,没有具体 ID 约定。不同视图实际浏览器行为可能不一致。
2. **`<JobCard />`** 的 `Run now` 按钮在「running」状态期是否被禁用?Plan 未定义;Spec 承诺「Concurrency=1」但 UI 允许点多次,对用户是空操作/等待,体验差。
3. **`<ProviderDialog />`** 的 Test 按钮在 create 模式禁用(Plan 代码 `disabled={mode === 'create'}`),迫使用户先 Save 才能 Test —— 与 Spec「Test button that runs a live `embed("test")` and displays `dim` + `costUsd` before save」**直接冲突**。Spec 承诺「save 前先 Test 看 dim」,Plan 实现是反的。
4. **单活跃切换**:用户在 UI 上勾选「active」为 true 保存,后端会把其它行全部 deactivate。但 UI 没预警「你即将停用 provider X」。风险:运维误操作,生产依赖的 provider 被静默换掉。
5. **Status 徽章 state 模型** 未在 Plan 里形式化成 discriminated union,仅在类型里列 5 个 `status` 字面量。React 组件渲染分支用 if/else,容易漏掉 `queued` 态,和 CLAUDE 代码风格要求「use discriminated unions for state machines」矛盾。
6. **设计基调(cyber/geeky/futuristic)** 在 Plan 里未呈现:Plan 用 `bg-amber-500/10` (警示黄)、`rounded-md border` —— CLAUDE 的 brand personality 明确说「无 gradient, 无 glassmorphism, 信息密度高」,plan 的 alert 设计是一条 Tailwind 默认样式,谈不上契合。
7. **"Active" 勾选**是普通 checkbox,Settings 页其他 CRUD 组件都用 shadcn Switch。Plan 用 `<input type="checkbox" />` 原生元素 —— 样式、Dark-mode 支持、a11y 三项都不及同屏其他组件,视觉上扎眼。

---

## 7. 运维 / 回滚 / 兼容

1. **无 kill switch**:一旦 PR E 部署,worker 会在 process 启动时吃掉 queued job。如果发现 bug,Spec/Plan 都没给「临时停 worker」 / 「清空 queue」 / 「把所有 running 强推 failed 并清回 queued」的 runbook。
2. **无 feature flag**:所有 PR 的改动直接进入 beta。operator 切换 provider 错误、找不回路径只能 SQL 手改。
3. **version-bump 节奏**:7 PR × patch + 最终 minor = **8 次版本递增**。CLAUDE.md 的版本规则是「feature = minor」,按理整套就一次 minor,不是七次 patch。beta 的 changelog 会被噪声淹没。
4. **DB 回滚**:0033 迁移的 down 脚本 Plan 没提。0033 包含 ADD COLUMN + ADD CONSTRAINT + CREATE INDEX + CREATE TABLE + CREATE TRIGGER —— 反向顺序要严格 reverse。Drizzle 不自动生成 down,需要手写。**Plan 完全回避**。
5. **mesh schema-ahead 行为**:Spec 声称「honouring the existing `sync_nodes_schema_ahead_rejection` contract」。Plan 没有测,一旦老 peer 不升级,所有 memory_ops_jobs 同步会卡住,用户无感;Plan 没规定 Ops UI 怎么显示「peer schema behind」状态。
6. **BullMQ `removeOnComplete: {count:500}` / `removeOnFail: {count:1000}`**:队列层的历史与 `memory_ops_jobs` 表的历史分头截断,时间一长就不一致。Plan 对「何时 purge DB 中历史 job」无策略。

---

## 8. 文档 / 可维护性

1. **3,146 行单文件 plan** 已超过项目 code-style.md 的「800 max」上限;同理应拆成 `plans/2026-04-24-memory-operations-ui-plan/pr-a.md`, `pr-b.md`, ..., `pr-g.md`。或者至少一个 `index.md` + 分文件。单文件把后续 patch/commit 放大成巨 diff,难以 code review。
2. **Plan 的 "Self-Review Checklist"** 自我打勾 `[x] Mesh sync for credentials and jobs → inherited via migration triggers (PR A)` —— **与 1.1 的致命错误 100% 冲突**,说明 self-review 是空走过场。
3. **Spec "Superseded: nothing"** 与存在「2026-04-15 MemPalace memory evolution plan」的交叉关系未澄清。Spec 应明确说明该 plan 的哪些节被本 Spec 延续/替代/无关,以防两个计划互相踩脚。
4. **Spec Open Questions 写得太软**:4 个问题中 (1)(2)(4) 都是 UX 偏好,不涉及架构。真正该问的问题(mesh-sync 语义、LiteLLM URL 变更、content_model 漂移、cost 统计)没出现。
5. **Spec Architecture 图** 展示了 Web → SSE → Fastify → Queue → Factory → PG,但没标 worker 的部署位置;而 Plan Task E3 又把 worker 塞进 control-plane 进程;图文不对等。
6. **Plan 变量命名风格错乱**:`MemoryOpsJob` 类型里 `credentialId` 是 camelCase,但 SQL/drizzle 用 snake_case `credential_id`,`rowToJob` 做一次映射,没问题;但 `params jsonb` 里 Plan 又存 snake_case 键(`sourceType` → `source_type`),前后端约定混乱。

---

## 9. 小瑕疵(但仍是扣分项)

1. Plan Task B3 import `maskCredential` 但全文不用;dead import,biome 会报。
2. Plan Task E1 `const texts = page.rows.map((r: { content: string }) => r.content);` 用 inline type 标 row shape,后续 PR 扩表加列会 silently 不匹配;应使用 Drizzle 推导类型。
3. `memory_ops_jobs.progress` 默认值 JSON `'{"done":0,"total":0,"costUsd":0,"errorCount":0}'` —— Postgres 需要显式 `::jsonb` 否则 `DEFAULT` 按 text 处理,某些客户端会在插入时类型不匹配。原 Spec SQL 已正确加了 `::jsonb`,Plan 的 `.default({ done: 0, ... })` 让 Drizzle 生成的是 jsonb 默认,问题不大,但手写 migration (Task A1) 仍要 `::jsonb`,Plan SQL 已写对,一致性过关。
4. Plan Task G8 「Final release: bump **minor**」—— 与 dev-flow 规则「Every promotion to beta requires a version bump」语义冲突:7 个 PR 期间已 patch 过 7 次,v0.2.x → v0.2.(x+7),最后再 bump minor 到 v0.3.0。看似可行,但 semver 意义下 v0.2.(x+7) 都带了 feature,已经破坏 patch=bugfix 语义。
5. Plan Task A1 的 journal update 描述「append a new entry following the same shape with incremented `idx`, new `tag` set to `0033_add_memory_ops`, `when` set to the current epoch milliseconds」—— Drizzle-kit 期望 `when` 是 `Date.now()` 整数;Plan 手写无错,但说「不要 freestyle JSON」又不给模板。若实施者搞错 idx 连续性,journal 直接 crash 不启动。
6. Plan 多处使用 `createSilentLogger()` 但未确认 `packages/control-plane/src/api/routes/test-helpers.ts` 导出它;memory 中的项目信息提到 CP 测试 helpers 含此函数,代码库里我没核实具体名字 —— Plan 也没核实。
7. EmbeddingBackfill 的「scope 过滤」只支持严格 `scope = $1`,不支持 `scope LIKE 'project:%'`,但 Spec 第 211 行 POST payload 例子里写了 `"scope": "project:agentctl"` —— 如果用户想按前缀 filter (例如 `project:*`) 做不到,**Spec 的 scope 语义未定义**(是精确匹配还是 glob?)。Plan 仅实现精确,与 Spec 第 248 行的 `scope LIKE $1` 又自相矛盾(SQL 用 LIKE,handler 用 `scope = $1`)。

---

## 10. 总结与强制要求

**必须在 Spec 修订并重发之前完成的事项:**

1. **解决 1.1 的 mesh 同步谎言。** 二选一,写进 Spec,并重写 §Data Model 的 mesh 段与 §Acceptance Criteria 的 peer 段。
2. **把 PR B 的 URL 语义变更拆出来**,或改用 additive config。如果决定 spec 的 Gemini base URL = `.../v1beta/openai/v1`,要更新 Spec §Embedding Client Factory 与 Plan Task A3 catalog。
3. **重写 Plan PR F 与 PR G**,按 PR B 的粒度补齐 failing test + impl + verify + commit。
4. **把 Plan 里所有凭空的 web 文件路径/模块名核对一遍**:`SettingsPage.tsx` → `SettingsView.tsx`;`apiFetch` → `request` from `core.ts`;`MemoryGraphPage` / `MemoryConsolidationView` → 真实文件清单;让 `<MissingEmbeddingAlert />` 挂载覆盖**真实存在的 8 个 Memory view**,并解释为何 DashboardView/ReportsView/ScopeManagerView 可以不挂(如果真的不需要)。
5. **把 `knowledge-maintenance.ts::runConsolidation` 替换成真实的 `KnowledgeMaintenance.run`**,并补齐构造函数依赖(pool/logger/embeddingClient)如何在 worker 里组装的代码。
6. **costUsd 端到端闭环**:EmbeddingClient 返回 usage → handler 累加 → DB 存 → UI 读。任何一段缺失都是不闭环。
7. **content_model 漂移**必须在 Spec 的 Non-Goals 或 Error Handling 里明确:要么禁用 provider 切换,要么规定切换时自动触发 re-embed 全集。
8. **performance budget** 明示在 Spec:batch UPDATE 用一条 SQL(给出 SQL 片段),以及 19k facts 完成时间的真实测量方法。
9. **transaction 化**:任何「先 deactivate 再 insert/update」的路径都必须事务或 partial unique index,Plan 须在路由代码里用 `db.transaction()`。
10. **下架 Plan 的 Self-Review Checklist 里的错误打勾**,或者改为「pending」。让它反映真实风险,而不是给自己贴金。

**不阻塞但强烈建议:**

- Plan 拆文件。
- 7 次 patch bump 改 1 次 feature flag + 1 次 minor bump,或保留 patch 但明示 changelog 归并策略。
- 增加「operator runbook」小节:purge queue、强推 job 到 failed、恢复 orphan credential_id 的手动 SQL。
- Spec 增加 §Telemetry: pino log 字段(`jobId`, `kind`, `credentialId last4`, `machineId`)清单,与项目 error-handling.md「Every log must include」规则对齐。
- 把 Spec 里的美元金额实测一次(OpenAI small 19k facts, Gemini 19k facts)写真实数字,不要是 `$0.08` 这种随手估。

---

## 附录 A:证据锚点(便于 re-review 时复现)

| 声明 | 代码证据 |
|---|---|
| api_accounts 非 mesh | `packages/control-plane/drizzle/0021_mesh_change_log.sql:130` 注释 + 该文件无 api_accounts trigger |
| memory_facts 是 mesh | 同文件 `:189-191` |
| KnowledgeMaintenance.run | `packages/control-plane/src/memory/knowledge-maintenance.ts:191` |
| KnowledgeSynthesis.runSynthesis | `packages/control-plane/src/memory/knowledge-synthesis.ts:78` |
| EmbeddingClient 无 apiKey | `packages/control-plane/src/memory/embedding-client.ts:1-167` |
| api_accounts 是 uuid 主键 | `packages/control-plane/src/db/schema.ts:446` |
| content_model 持久化每行 | `packages/control-plane/drizzle/0010_add_memory_layer.sql:24` |
| settings 实际页面 | `packages/web/src/views/SettingsView.tsx` + `views/settings/SettingsShell.tsx` |
| web api 客户端模式 | `packages/web/src/lib/api/core.ts:21` (`request<T>`), `packages/web/src/lib/api/machines.ts:15` (`import { request } from './core'`) |
| memory views 实际清单 | `packages/web/src/views/Memory*.{tsx}` ls (8 个) |
| rate-limit env helper | `packages/control-plane/src/api/rate-limit.ts:31` |
| credential-crypto API | `packages/control-plane/src/utils/credential-crypto.ts:7-40` |

---

## 附录 B:一行总结

> Spec 把 v1 的「门槛功能」说得清楚,但**在 mesh 架构上讲了个不真实的故事**;Plan 把 PR 分阶段做得认真,但**对当前代码库的文件命名/方法命名/URL 语义/错误路径的假设在至少 7 处与现实不符**,且**把一次性 breaking change 裹进了非破坏性 PR 里**。**不改就上,必炸 beta。**
