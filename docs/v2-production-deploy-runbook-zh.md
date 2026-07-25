# 拾贝 V2 生产替换部署 Runbook

更新时间：2026-07-09

这份 runbook 用于把 V2-capable root backend 部署到当前同一个 Railway production service，并在通过 gate 后继续手机/正式包验收。它不是 UI/Prompt 设计文档；它只回答上线操作时“该先看什么、点什么、跑什么、失败时停在哪里”。

## 当前状态

- 目标生产 URL：`https://shibei-production.up.railway.app`
- 目标生产 bundle id：`com.maxhan.shibei`
- 候选分支：`codex/shibei-v2-isolated-build`
- 候选 PR：`https://github.com/MaxHan7/ShiBei/pull/3`
- 当前生产 gate 预期失败点：production health 里缺少 V2 capability flags。
- 当前结论：本地/root backend 已有 V2 能力；线上 production service 还没有部署到这份 V2-capable commit。
- 最近一次复核：2026-06-26，在候选 PR head 运行无副作用 production gate，结果仍是 health/database/queue/APNS 通过，V2 capability flags 失败。候选 PR 的 GitHub Actions `V2 Production Readiness` 已通过；具体最新 run 以 PR checks 为准。

## 不允许跳过的原则

- 不在不知道 Railway 当前 deployment id 的情况下直接替换。
- 不在没有明确数据策略的情况下做 production smoke。
- `preserve-data` 模式下，不在没有数据库备份/恢复路径的情况下做 production smoke。
- `reset-data` 模式只允许用于本轮 V2 首次 production test：旧 production 数据必须确认只是可丢弃测试数据，并且先做一次旧数据导出记录。
- 不在 `gate:production` 默认无副作用检查失败时运行 `--smoke`。
- 不把任何模型 Key、数据库 URL、APNS 私钥写进文档、commit、issue 或 PR。
- 不把 `experiments/shibei-v2/backend` 当作正式部署路径；正式路径是根目录 `backend/`。

## 部署前确认

### 1. 记录回滚点

需要人工在 Railway / GitHub / 本地记录：

- 旧 backend git commit：
- 当前 Railway deployment id：
- 当前 Railway service 连接的 GitHub branch：
- Railway autodeploy 是否开启：
- 数据策略：`preserve-data` 或 `reset-data`
- 如果是 `reset-data`：旧 production 数据状态、清空确认、旧数据导出引用和导出时间
- 如果是 `preserve-data`：数据库备份名称或快照时间、数据库恢复方式

如果任何一项无法记录，停止上线。

可选但推荐：先复制 `docs/production-readiness-evidence/deployment-inputs.template.md` 作为部署输入核对表，给有 Railway 权限的操作者逐项填写 service id、旧 deployment、数据策略和回滚路径。这个模板只用于人工准备，不会被最终 Release evidence gate 当作正式部署证据；正式部署证据仍由 GitHub Actions 部署 workflow 生成的 `deployment-intent.md` 或等效审计记录提供。

填写完成后，可以先用本地 preflight 检查是否漏填或误写 secret：

```bash
npm run check:production-deploy-inputs -- \
  --inputs docs/production-readiness-evidence/YYYYMMDD-deployment-inputs.md
```

这个检查只确认上线输入是否完整、是否没有把密钥值写进文件；它不会连接 Railway，也不会替代部署后的 production gate / smoke / 手机 E2E。

本轮 V2 首次 production test 的当前决策：

- 数据策略：`reset-data`
- 决策人确认：旧 production 测试数据可以清空，V2 从空库重新测试。
- 额外保险：清空前先导出一份旧数据，记录为 `Old data export reference`。
- 注意：`reset-data` 不是长期策略。正式开放真实用户前，必须回到 `preserve-data`，补齐备份、恢复演练和迁移策略。

旧测试数据导出方式：

1. 确认 GitHub repository secrets 里已经存在：
   - `RAILWAY_TOKEN`：用于 `railway up` 部署的 project token。
   - `RAILWAY_API_TOKEN`：用于读取 Railway project/service variables 的 account/workspace token。
2. 在 GitHub Actions 手动运行 `V2 Production DB Export`。
3. 输入：
   - `confirmation`: `export-old-test-data`
   - `railway_project_id`: Railway project id
   - `postgres_service_id`: Railway Postgres service id
   - `railway_environment`: `production`
   - `retention_days`: 建议第一轮填 `7`
4. workflow 会通过 Railway CLI 读取 Postgres service 的数据库 URL，但不会把 URL 打印到日志。
   - GitHub Actions 在 Railway 外部运行，因此导出会优先使用 `DATABASE_PUBLIC_URL` / public TCP proxy。
   - 如果 Postgres 没有开启 Public Networking / TCP proxy，导出可能无法连接；这时先在 Railway Postgres service 的 Networking 里启用 public TCP proxy，再重新运行导出 workflow。
5. 下载或记录 artifact：`v2-old-production-test-data-export`。
6. 把 artifact run URL、文件名或 SHA256 写入 deployment inputs 的 `Old data export reference`。

正式部署 workflow 的 `reset-data` 行为：

- workflow：`V2 Production Railway Deploy`
- `data_strategy` 填 `reset-data` 时，会在真正部署前执行受保护的数据库清空步骤。
- 必须同时填写：
  - `database_backup_reference`: 上一步旧测试数据导出 artifact / run URL / SHA256
  - `data_reset_confirmation`: `reset-old-test-data`
  - `railway_project_id`
  - `postgres_service_id`
  - `railway_environment`
- reset 只清空 app 自己的表：`devices`、`chapters`、`notifications`、`generation_jobs`、`device_push_tokens`、`favorite_questions`。
- `preserve-data` 模式不会执行 reset；真实用户上线必须走 `preserve-data`。

### 2. 确认环境变量

只确认 key 是否存在，不记录值：

- `RAILWAY_TOKEN`
- `RAILWAY_API_TOKEN`
- `DATABASE_URL`
- `DEEPSEEK_API_KEY` 或 `OPENAI_API_KEY`
- `AI_PROVIDER`
- `DEEPSEEK_MODEL` 或 `OPENAI_MODEL`
- `APNS_TEAM_ID`
- `APNS_KEY_ID`
- `APNS_BUNDLE_ID`
- `APNS_PRIVATE_KEY_BASE64` 或 `APNS_PRIVATE_KEY`
- `APNS_ENV`

生产期望：

- `APNS_BUNDLE_ID=com.maxhan.shibei`
- `APNS_ENV=production`

内容解析能力新增必配变量：

- `TIKHUB_API_KEY`：抖音/小红书视频取源，以及小红书图文、公众号和知乎来源增强。只确认存在，不记录值。
- `QWEN_API_KEY` 或 `DASHSCOPE_API_KEY`：截图直接识别和复习题生成。只确认存在，不记录值。
- `RUNTIME_READINESS_TOKEN`：仅用于部署检查访问 `/api/source/runtime-readiness`，不能暴露给客户端。

视频能力的产品默认值由代码集中维护，除非产品策略变化，不建议在 Railway 手动覆盖：

- `VIDEO_MAX_DURATION_SECONDS=900`
- `VIDEO_LINK_ENABLED=1`
- `VIDEO_YTDLP_ENABLED=1`
- `VIDEO_ASR_PROVIDER=local_whisper`
- `VIDEO_FRAME_PROVIDER=none`
- `VIDEO_VISUAL_PROVIDER=none`
- `TIKHUB_CONTENT_ENABLED=1`

B 站优先版本先用截图视觉识别确定视频，再以字幕或 ASR 补充上下文，因此默认不对整段视频抽帧或再次调用视觉模型。需要评估无字幕视频时，再显式开启 `crv_style_ffmpeg` 和 `qwen-vl`。

如果必须临时关闭视频能力，优先设置 `VIDEO_LINK_ENABLED=0`，并在 deployment intent 中记录原因和恢复条件。不要通过删除 provider key 来“临时关闭”，否则 readiness 结果会变成配置缺失，难以区分策略关闭和环境损坏。

### 3. 本地候选代码检查

候选 PR/commit 应先看到 GitHub Actions `V2 Production Readiness` 通过。该 CI 会跑：

- root `npm run check`；
- iOS Debug simulator compile；
- iOS Release simulator compile。

当前最新候选提交验证通过的 CI run 以 PR checks 为准：

- `https://github.com/MaxHan7/ShiBei/pull/3`

备注：CI 曾在 GitHub runner Xcode 16.4 上暴露通知页 SwiftUI body 类型检查失败；候选提交已拆分该布局并通过 Debug/Release 远端编译。

iOS readiness CI 固定使用 `macos-15`，避免 `macos-latest` 迁移到 macOS 26 / Xcode 26 时在上线前引入新的编译环境变量。需要迁移 Xcode 26 时应单独建 checkpoint 验证。

CI 通过后，再在本地或 release 机器上跑以下人工确认项：

```bash
git status --short
npm --prefix backend run gate:routes
npm --prefix backend run check
RUNTIME_READINESS_TOKEN=<token> npm --prefix backend run gate:production -- --require-video 1
npm run check:ios-production
xcodebuild -project 拾贝/拾贝.xcodeproj -scheme Recallo -destination 'generic/platform=iOS Simulator' -configuration Debug build
xcodebuild -project 拾贝/拾贝.xcodeproj -scheme Recallo -destination 'generic/platform=iOS' -configuration Release build
```

如果任何一项失败，停止上线。

`gate:routes` 是无网络、无副作用的本地路由契约检查。它用于确认当前 root backend 代码仍暴露 V2 App 上线需要的章节生成、复习 session、收藏、通知、推送和 source anchor 路由；它不能替代部署后的 `gate:production`。

`gate:production -- --require-video 1` 会额外检查视频 capability、YouTube/B站 preflight、15 分钟限制和 runtime readiness。runtime readiness HTTP 入口需要 `RUNTIME_READINESS_TOKEN`，没有 token 时线上接口应返回 404，这是预期的安全行为。

注意：generic Release build 只能证明代码能编译，不能证明 TestFlight/App Store 签名正确。创建 release candidate archive/export 后，还必须检查实际签名产物：

```bash
npm run check:ios-signing -- --app /path/to/拾贝.app
```

这个检查必须看到 production APNS，并且 `get-task-allow` 必须是 `false`。如果本机自动签出来的是 development profile，这一步会失败，不能发布。

## 部署方式

选择一种，不要混用：

### 方式 A：Railway GitHub 自动部署

适用条件：

- Railway service 连接 `master` 或另一个明确分支。
- 已确认合并 PR 会触发目标 production service 部署。

步骤：

1. 将 PR 从 Draft 改为 Ready only after all pre-merge checks are acceptable.
2. 合并 PR 到 Railway 连接的分支。
3. 在 Railway 面板观察新 deployment 完成。
4. 记录新 deployment id。

### 方式 B：Railway 面板手动 Deploy Latest Commit

适用条件：

- Railway service 已连接 GitHub 分支。
- 操作者能在 Railway 面板选择目标服务并手动部署 latest commit。

步骤：

1. 确认 connected branch 上的 latest commit 是 V2 候选 commit。
2. 在 Railway 面板对目标 service 执行 Deploy Latest Commit。
3. 等待 healthcheck 通过。
4. 记录新 deployment id。

### 方式 C：Railway CLI 手动部署

适用条件：

- 本机已登录 Railway，或 CI 有 `RAILWAY_TOKEN`。
- 已明确选择目标 project / environment / service。

步骤：

```bash
railway link
railway status
railway up
```

只有 `railway status` 显示的 project / environment / service 与 production 目标一致时才允许执行 `railway up`。

### 方式 D：GitHub Actions 手动部署到 Railway

适用条件：

- 仓库 secrets 已配置 `RAILWAY_TOKEN`。Railway 官方 CLI 支持在 CI 中用 project token 通过 `RAILWAY_TOKEN` 执行 `railway up`。
- 操作者知道目标 Railway service id。
- 只允许从已经通过 `V2 Production Readiness` 的候选 commit 触发。

步骤：

1. 打开 GitHub Actions，选择 `V2 Production Railway Deploy`。
2. `confirmation` 必须输入 `deploy-v2-production`。
3. `railway_service_id` 填目标 Railway production service id。
4. `current_deployment_id` 填替换前的 Railway production deployment id。
5. `database_backup_reference` 填替换前创建或确认的数据库备份/快照引用。
6. `rollback_confirmation` 必须输入 `rollback-ready`，表示旧 deployment 和 DB 恢复路径已经记录。
7. `base_url` 保持 production URL，除非是在 staging-equivalent service 上演练。
8. 第一轮保持 `smoke_after_gate=false`。
9. workflow 会先写出 deployment intent artifact，再运行 root production checks，再执行 Railway deploy，然后等待 `/api/health`，最后写出 production gate JSON/Markdown artifact。
10. 只有无副作用 gate 全部通过后，第二轮才允许用 `smoke_after_gate=true`。

这个方式的优点是部署、gate 和证据 artifact 在同一个审计轨迹里；缺点是仍然需要 Railway token 和 service id。没有这两项时，不要尝试绕过。

## 部署后 Gate

### 1. 无副作用生产 gate

```bash
npm --prefix backend run gate:production -- --base-url https://shibei-production.up.railway.app
```

必须看到：

- backend health pass
- database health pass
- queue visible pass
- `capability_v2ChapterGeneration` pass
- `capability_v2ReviewSessions` pass
- `capability_favoriteQuestions` pass
- `capability_notifications` pass
- `capability_sourceAnchors` pass
- APNS production checks pass

如果 capability 仍然失败，说明 production 没部署到当前 V2-capable backend，停止，不跑 smoke。

建议部署后同时保存证据文件：

```bash
npm --prefix backend run gate:production -- \
  --base-url https://shibei-production.up.railway.app \
  --json-out docs/production-readiness-evidence/YYYYMMDD-HHMM-production-gate.json \
  --markdown-out docs/production-readiness-evidence/YYYYMMDD-HHMM-production-gate.md
```

证据文件会记录 base URL、当前 git commit、queue 状态、V2 capability、APNS 摘要、每个 gate check 的 pass/fail。默认模式无副作用，可以在 smoke 前反复运行。

如果部署操作者不方便在本机跑命令，也可以在 GitHub Actions 手动触发 `V2 Production Gate Evidence`：

1. 打开 PR/仓库的 Actions 页面。
2. 选择 `V2 Production Gate Evidence`。
3. `base_url` 填目标后端 URL，默认是 production。
4. 第一轮保持 `smoke=false`，只跑无副作用 readiness gate。
5. 只有 readiness gate 全部通过后，第二轮才把 `smoke=true`。
6. 下载 workflow artifact `v2-production-gate-evidence`，保存其中的 JSON/Markdown 作为上线证据。

### 2. 生产 controlled smoke

只有上一步通过后才运行：

```bash
npm --prefix backend run gate:production -- --base-url https://shibei-production.up.railway.app --smoke
```

如果要保存 smoke 证据：

```bash
npm --prefix backend run gate:production -- \
  --base-url https://shibei-production.up.railway.app \
  --smoke \
  --json-out docs/production-readiness-evidence/YYYYMMDD-HHMM-production-smoke.json \
  --markdown-out docs/production-readiness-evidence/YYYYMMDD-HHMM-production-smoke.md
```

通过标准：

- 创建 V2 chapter 成功。
- 生成 progress 能推进。
- 最终 completed，或在明确失败输入下进入可解释 failed state。
- 不出现永久卡在 generating / running 的状态。

### 3. 手机 E2E

用真实手机或 TestFlight/internal build 验证：

- 输入链接/文本。
- 进入章节正在生成详情页。
- 看到用户可读阶段文案。
- 完成后进入章节详情。
- 开始复习并完成至少一题选择题。
- 如果生成连线题，完成一题连线题。
- 从题目查看原文，再返回，不丢答题状态。
- 收藏题目，进入笔记页打开收藏题目。
- 杀进程重开，复习状态仍能恢复。

建议将手机验收结果写入一份 Markdown 记录，保存到 `docs/production-readiness-evidence/` 或下载到本地交接目录。记录里必须明确覆盖：

- create chapter
- progress
- review
- source return
- favorites
- notifications

仓库已提供模板：

```bash
cp docs/production-readiness-evidence/phone-e2e.template.md \
  docs/production-readiness-evidence/phone-e2e.md
```

填写完成后，`phone-e2e.md` 会被最终 Release 证据 gate 检查。模板文件本身不会被 `--evidence-dir` 自动当作完成证据。

### 4. Release 前最终证据 gate

只有 deployment intent、无副作用 gate、production smoke、手机 E2E、最终签名产物都齐了之后，才允许切 Release 入口到 V2。切入口前先运行：

```bash
npm run check:production-release-evidence -- \
  --evidence-dir docs/production-readiness-evidence \
  --signed-app /path/to/拾贝.app
```

如果证据文件不在同一个目录，或需要手动指定某次 artifact，也可以使用显式路径：

```bash
npm run check:production-release-evidence -- \
  --deployment-intent docs/production-readiness-evidence/deployment-intent.md \
  --gate-json docs/production-readiness-evidence/production-gate.json \
  --smoke-json docs/production-readiness-evidence/production-smoke.json \
  --phone-e2e docs/production-readiness-evidence/phone-e2e.md \
  --signed-app /path/to/拾贝.app
```

这个 gate 会检查：

- deployment intent 里记录了旧 production deployment id 和数据库备份引用；
- no-side-effect production gate 是 `passed`，且 smoke 未开启；
- production smoke 是 `passed`；
- V2 capability、database、APNS production、bundle id 全部通过；
- 手机 E2E 记录覆盖真实生成、进度、复习、查看原文返回、收藏、通知；
- 最终导出的 `.app` 通过 `ios-signing-guard`。

使用 `--evidence-dir` 时，脚本会按文件名寻找 `deployment-intent.md` 和 `phone-e2e.md`，并通过 JSON 内的 `smokeRequested` 区分无副作用 gate 与 smoke 证据。这样 GitHub Actions 下载下来的时间戳证据可以直接放进 `docs/production-readiness-evidence/`，不需要人工改名。

这一步是 Release flip 的最后一道本地证据检查。它不是现在就能通过的检查；它必须在真实 production 部署和最终签名导出之后运行。

## 停止条件

遇到以下任一情况，立即停止继续上线：

- `gate:production` 默认模式失败。
- `--smoke` 创建章节失败或永久卡住。
- 生产 DB 连接失败或 queue 长时间堆积。
- APNS production 配置不匹配 `com.maxhan.shibei`。
- 手机 E2E 丢失复习进度、收藏状态或 source anchor。
- 新部署后旧版核心功能不可用。

## 回滚路径

优先级从低破坏性到高破坏性：

1. Railway 回滚到旧 deployment id。
2. 如果是 GitHub branch autodeploy，revert merge commit 并等待重新部署。
3. 如果数据被错误写入但 schema 未破坏，优先用代码修复兼容读取。
4. 如果出现数据破坏，按上线前记录的数据库备份恢复。
5. 如果客户端已发版且出现严重问题，准备 iOS hotfix 或回滚说明。

回滚后立即运行：

```bash
curl https://shibei-production.up.railway.app/api/health
```

并确认旧版 App 的核心生成/章节列表/通知路径恢复。

## 当前下一步

当前 Codex 环境没有 Railway 登录态，无法直接执行 production deployment。需要有 Railway 权限的操作者完成以下任一动作：

1. 在 Railway 面板确认当前 service 连接分支和当前 deployment id。
2. 创建数据库备份或确认可恢复快照。
3. 将目标 service 部署到 V2 候选 commit。
4. 部署后把 deployment id 记录回本文件的部署记录部分。
5. 运行本文件的生产 gate 命令。
