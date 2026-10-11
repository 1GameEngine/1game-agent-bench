# PROCESS.md — 隔离诚实声明（P0）

Cursor **没有** ACL。同一 Linux 用户、同一 VM **不是**密封。P0 强制约定：

1. Builder 工作区根 = `work/<runId>/game`，**不要**把 `eval/` add 进同一个 Cursor workspace。
2. Judge 是评测仓里的 **另一个 Node 进程**。Headline 的 M、D、V、A 都由 looks subagent 看重放静帧对照隐藏量表，不是 screenshot 当金标，也不读内部字段。
3. 不要把 rubric 或任何成品当作 Builder 可见答案塞进 `game/`。本仓不带参考作。
4. 禁止 `1game-skill activate --global`。
5. 下一题新 `runId`，禁止跨任务复用未校验 pin 的 `node_modules`。
6. 不要求 Docker/user namespace（可选加固，非 P0 验收项）。
7. 残余风险不要对外称为「已密封」：
   - `/tmp` 与其它世界可读临时文件
   - `ps` / 进程列表可见 Judge 命令行（含 checkpoint 绝对路径）
   - npm/pnpm cache、npx 缓存里的 `@1game/cli@1.23.0`
   - 同一用户可读本评测仓（若 Builder 与 Judge 同机同用户）
   - 环境变量、shell history、IDE 本地历史

实现方 **不得** 克隆或阅读 `1game-engine` 的 `docs/`、`packages/*/src`、`apps/cli-demos`。字段合同只认 npm `1.23.0`。

编排器 LLM / Cursor Cloud **不是** 确定性 Judge。

`eval.execution/2` 的执行工作进程仅隔离阻塞操作并接受进程组监管，不是替代 Builder、Debug 或 Looks 的内置模型 worker，也不增加 ACL。阶段事件及终态用于追踪真实执行；`SUBMISSION.json` 的源码、轨迹和资产摘要只关联观测版本，不是安全签名、原子冻结或密封证明。任意外部链接不遍历，约定的凭据文件不纳入清单，未覆盖或读取期间变化的内容保留诊断；同一用户仍有上述残余访问能力。当前没有跨套件资源隔离或 CPU、内存配额，不应声称已实现独占资源公平。

报告存储按内容哈希归档已评分静帧，重建前核验全部证据并只使用归档字节，不从可变游戏工作区补图或重新执行。它保护报告投影的版本一致性，不提供跨用户隔离、数字签名或对同用户篡改的安全证明。旧运行仅由已有分数重出 HTML，不能借重建重新裁决或追加新执行协议。

M、D、V、A 都由每个引擎的 looks subagent 按该题 `sample_fps` 抽帧打出（每段最多 40 张）。裁决必须逐条带静帧 id；没有证据则该题百分制留空。单场景条目取最高，贯穿条目对缺场景按 0 取平均。**百分制只在 `looks_source=subagent` 时出现**。G 要求能启动且至少一条轨迹重放成功。题目不带 `probe.json`。`EVAL_LOOKS_ALLOW_WORKER=1` 和 `EVAL_LOOKS_BACKEND=heuristic` 不能写出百分制。Cloud Agent（`CURSOR_AGENT=1`）默认把 builder / looks 交给当前 subagent，不需要 `EVAL_SUBAGENT_CMD`。既不是 Cloud Agent、也没有 `EVAL_SUBAGENT_CMD` → `SUBAGENT_REQUIRED`。

两引擎都 `G=1` 时，抽帧必须成对且均为 **1280×720**；缺一侧则 `INCOMPARABLE_VISUAL`。Godot 用 SubViewport 出图；禁止 Xvfb 视频与 napi-canvas 静帧混成同一视觉分。
