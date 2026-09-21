# PROCESS.md — 隔离诚实声明（P0）

Cursor **没有** ACL。同一 Linux 用户、同一 VM **不是**密封。P0 强制约定：

1. Builder 工作区根 = `work/<runId>/game`，**不要**把 `eval/` add 进同一个 Cursor workspace。
2. Judge 是评测仓里的 **另一个 Node 进程**。Headline 机械分来自 traces 重放抽帧 + 隐藏量表，不是 screenshot 当金标。
3. 不要把 rubric / 官方 traces 当作 Builder 可见答案塞进 `game/`（oracle 验收除外）。
4. 禁止 `1game-skill activate --global`。
5. 下一题新 `runId`，禁止跨任务复用未校验 pin 的 `node_modules`。
6. 不要求 Docker/user namespace（可选加固，非 P0 验收项）。
7. 残余风险不要对外称为「已密封」：
   - `/tmp` 与其它世界可读临时文件
   - `ps` / 进程列表可见 Judge 命令行（含 checkpoint 绝对路径）
   - npm/pnpm cache、npx 缓存里的 `@1game/cli@1.21.0`
   - 同一用户可读本评测仓（若 Builder 与 Judge 同机同用户）
   - 环境变量、shell history、IDE 本地历史

实现方 **不得** 克隆或阅读 `1game-engine` 的 `docs/`、`packages/*/src`、`apps/cli-demos`。字段合同只认 npm `1.21.0`。

编排器 LLM / Cursor Cloud **不是** 确定性 Judge。

观感与机械（M/D/V/A）走 **同一套 looks-job 隐藏量表**，输入是 traces 重放抽帧。**跑分必须由真实 looks subagent 写 `looks-verdict.json`**，`looks_source=subagent` 才可比。内置 looks-job worker 仅 `EVAL_LOOKS_ALLOW_WORKER=1` 调试，`looks_source=worker`，不得宣布胜者。无外部评委 → `SUBAGENT_UNAVAILABLE`。`EVAL_LOOKS_BACKEND=heuristic` 仅调试。

两引擎都 `G=1` 时，抽帧必须成对且均为 **1280×720**；缺一侧则 `INCOMPARABLE_VISUAL`。Godot 用 SubViewport 出图；禁止 Xvfb 视频与 napi-canvas 静帧混成同一视觉分。
