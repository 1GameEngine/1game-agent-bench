# PROCESS.md — 隔离诚实声明（P0）

Cursor **没有** ACL。同一 Linux 用户、同一 VM **不是**密封。P0 强制约定：

1. Builder 工作区根 = `work/<runId>/game`，**不要**把 `eval/` add 进同一个 Cursor workspace。
2. Judge 是评测仓里的 **另一个 Node 进程**，用绝对路径读 checkpoint。
3. 不要把 checkpoint / playplan 复制进 `game/`。
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

观感（好看 / 能否看清 / 静帧是否对得上 dump）走 **独立 looks-job + subagent**，角色不是 Capture，也不是机械 Judge。机械正确性仍只认 dump/checkpoint。缺 subagent 时记 `SUBAGENT_UNAVAILABLE`，不得悄悄改用启发式充当套件分。`EVAL_LOOKS_BACKEND=heuristic` 仅调试。

两引擎都 `G=1` 时，静帧必须成对（均为逻辑 320×180 → 1280×720）；缺一侧则 `INCOMPARABLE_VISUAL`，套件不得宣布 `product_100` 胜者。Godot 抓静帧可用 Xvfb **单帧**，禁止把 Xvfb 视频与 napi-canvas 静帧混成同一视觉分。
