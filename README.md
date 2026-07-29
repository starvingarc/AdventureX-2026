<div align="center">
  <img src="Omo/Omo/Assets.xcassets/OmoPoseHeart.imageset/omo-pose-heart-512.png" width="148" alt="Omo mascot">
  <h1>Omo · 哦莫</h1>
  <p>把保存过的碎片，变成会再次想起的记忆。</p>
</div>

Omo 把社媒截图变成会再次出现的记忆卡。当前仓库只保留一条产品链路：

```text
选择截图 → Qwen 生成一张记忆卡 → 今日抽卡 → 刮开答案
→ 记得 / 模糊 / 忘记 → 安排下次召回
```

## 目录

```text
Omo/Omo/          6 个 Swift 运行时文件与 Asset Catalog
backend/src/      4 个 Node.js 运行时文件
backend/test/     最小后端合同测试
api/index.js      Vercel 入口
```

已移除旧章节、推荐内容、通知、后台队列、ASR 和多套兼容 UI。R / SR / SSR 只表达卡牌视觉等级，不参与概率、付费或复习调度。

多人 Coding Agent 协作从 [AGENTS.md](AGENTS.md) 开始；活动计划见 [PLANS.md](PLANS.md)，稳定文档入口见 [docs/index.md](docs/index.md)。

## 快速开始

要求 Node.js 20+、Xcode 16+。复制 `backend/.env.example` 中需要的值到根目录 `.env`；真实截图生成至少需要 `QWEN_API`，canonical 模型配置为 `QWEN_BASE_URL`、`QWEN_MODEL` 和 `QWEN_TIMEOUT_MS`。

```bash
npm --prefix backend run dev
```

后端地址为 `http://127.0.0.1:5174`。打开 `Omo/Omo.xcodeproj`，选择 iPhone Simulator 运行；Debug App 默认连接本地后端。

未配置 Qwen 时，请求默认返回 `503 model_not_configured`，不会生成演示成功。本地需要固定 Fixture 时必须显式设置 `OMO_DEMO_MODE=1`；生产环境禁止 Fixture。`GET /api/health` 只检查进程存活，`GET /api/readiness` 检查模型、来源服务与存储依赖。

截图处理先由 Qwen 提取当前内容的标题、作者与平台，再通过 TikHub 严格核对原来源。只有标题和作者同时匹配时才标记为“TikHub 已核验”；缺少配置、超时或上游失败都保留为带 `sourceReason` 的 `screenshot_only`，不会伪装成已核验。

当前 JSON Store 只用于本地开发，不是耐久生产存储。因此 `NODE_ENV=production` 下 readiness 和业务接口会保持失败，直到接入通过验证的耐久存储 Adapter；本地测试通过不代表 Railway、Vercel 或真实提供方已经验证。

## 检查

```bash
npm --prefix backend run check
npm --prefix backend test
xcodebuild -project Omo/Omo.xcodeproj -scheme Omo \
  -destination 'platform=iOS Simulator,name=Omo iPhone 17 Pro' test
```
