# 1Game × Godot LLM 生成游戏评测（eval-spec/1）

私有评测产品。不要发到 npm，不要做成 `1game-*` skill。

**当前里程碑：product_100。** 跨引擎谁赢只看 **headline 题等权平均的百分制** `product_100`（谱面冲刺、货仓交火、塔防）。结论句只引用这些题的套件分。

过程指标仍产出、不决定胜负：P0 四题五维表（夹具，不进 headline）、`COMPARE_SCALAR = TRACE_OK / ATTEMPTS`。禁止 `overall` / `total_score` / `vlm_*`。

Headline 在 `compare_tasks`：`p1-chart-rush`、`p1-depot-skirmish`、`p1-tower-defense`。`p1-slide-puzzle` 仍可加载，不进套件分。本仓不带参考作。

Godot 安装见 [`INSTALL-godot.md`](INSTALL-godot.md)。Builder 提示：[`builder.prompt.p1.onegame.md`](builder.prompt.p1.onegame.md) 与 [`builder.prompt.p1.godot.md`](builder.prompt.p1.godot.md)（仅附录 A 不同）。

实现说明是题面 `instruction.md`，末尾拼上 `tasks/_shared/constraints.md`。隐藏量表在 `tasks/<id>/judge/rubric.json`，Builder 不可见。题目不再带 `probe.json`。本仓没有 `examples/`，也没有可照抄的参考作。`run-oracles` 与默认的 `run-oracle-gate` 以 `NO_REFERENCE` 停止。每次 `run-product-100` / `run-p1-compare` 都按引擎拆成 builder、debug、replay、looks 四个 subagent。在 Cloud Agent 里（`CURSOR_AGENT=1`）不需要 `EVAL_SUBAGENT_CMD`：builder、debug 和 looks 默认交给当前 Cloud Agent 的 subagent，请求落在 `work/.cloud-agent-tasks/*.request.json`，回应写成同名 `.response.json`（`{"stdout":"","exitCode":0}`）。重放由适配器执行 `stage-replay`，主进程不手写 `REPLAY.json`。打开 worker / heuristic 不出百分制。不在 Cloud Agent 里、又没设 `EVAL_SUBAGENT_CMD` 时，以 `SUBAGENT_REQUIRED` 停止。`EVAL_SUBAGENT_CMD` 仍可覆盖默认入口。

阶段入口默认是当前 Cloud Agent 的 subagent。`EVAL_SUBAGENT_CMD` 可选（cwd 为该引擎工作区，stdin 为 `{role,engine,taskId,workspace,prompt,...}`）。`role` 依次是 `builder`、`debug`、`replay`、`looks`，两边引擎互不可见。主进程不写 `game.tsx` / `game.gd`，不手写重放结果，不看图。Builder 把提交写进工作区。主进程接着审计轨迹，并做构建和一次启动校验：1Game 跑 `1gameplay create` 且 store 已绑定，Godot 做 headless import 后让主场景跑一帧。共用正文要求提交前按轨迹逐步自查，这段说明不写引擎命令。失败把错误文本交回同一个 builder，默认最多 3 次（`EVAL_BUILDER_BOOT_ATTEMPTS`），并要求按同一段自查再走一遍。静态审计在最后一次仍失败则 `BUILDER_INVALID`，不重放。启动通过后进入一轮 debug：引导只写游戏需求和 `demo_outputs` 测试用例，不写引擎命令，也不给构建日志。debug 改完再审计一次，失败则 `BUILDER_INVALID`，不重放。启动仍失败则跳过 debug，进入重放，由重放记下 `BUILD_FAIL` / `BOOT_FAIL`。Replay 只能执行 `node src/cli.mjs stage-replay ...`，由该命令写出带 `via:"stage-replay"` 和本次令牌的 `REPLAY.json`；手改文件会被 `REPLAY_UNTRUSTED` 拒绝。Looks 只看这一边的静帧，M、D、V、A 四类都在这一步打完，每条带静帧 id。主进程只按场景取最高、贯穿取平均后套公式，不再用探针，也不做跨条目封顶。`EVAL_BUILDER_CMD` 只留给单独的模型写盘试验，headline 跑分不走它。

评测重放的是这次写出的 traces（`demo_outputs/*.json`，`eval.trace/1`，30fps）。M、D、V、A 都由 looks subagent 看该边静帧打出，每条 0、0.5 或 1，并引用静帧 id。只属于一个场景的条目取各段最高分，贯穿多段的条目取平均。没有证据的条目为 0，不按内部字段名封顶。G 要求能启动，并且至少一条轨迹重放成功。没有 subagent 时不出百分制。

## 读者与隔离

- 实现方看不到 `1game-engine` 源码；只使用公开 npm train **`1.23.0`**。
- Builder 的 Cursor **只打开** `work/<runId>/game`，不要把本 `eval/` 仓加进同一 workspace。
- Judge 是本仓另一个 Node 进程。
- 不要把 rubric 复制进 Builder 工作区当答案。本仓不附带成品。
- 禁止 `1game-skill activate --global` 与 `npx skills add`。

Linux 同用户同 VM **不是密封**。残余风险见 `PROCESS.md`。不要对外声称已密封。

## 运行时钉死（P0）

| 项 | 值 |
|---|---|
| Node | ≥ 20 |
| 包管理器 | **只允许 pnpm 9+**（装依赖不要混用 npm） |
| 公开 train | `1.23.0` 精确字符串，无 `^` |
| 必须同版本 | `@1game/cli` `@1game/engine-bundle` `@1game/cli-1gameplay` `@1game/skill` |
| 游戏入口 | `src/game.tsx` |
| 场景 | 恰好 1 个 `<scene>`，1280×720 |
| 点击 | scene 逻辑像素；评测点 geometry 命名区中心（或 playplan 写死中心） |
| Judge（正确性） | Headline：提交 traces 重放抽帧 + 隐藏量表。P0 夹具仍只 `1gameplay frame query --select store:state`。不用 Chromium |
| Capture（观感） | 重放抽帧 1280×720 PNG。Capture **不是** 单独的机械金标。 |
| Looks（M/D/V/A） | 每引擎一个 looks subagent，只看该边静帧打四类。worker / heuristic 不得当 headline。 |
| Replay | Replay subagent 只能跑 `stage-replay`。30fps 提交轨迹。抽样频率和单条上限写在题目的 `sample_fps`、`max_demo_seconds` 里，乘积不超过 40 张静帧。超长轨迹审计失败，不截断。 |

作者入口激活器是 `1game-skill`（来自 `@1game/skill`），**不是** `npx skills add`。

## Builder 引导（逐字）

```bash
node -v          # >= 20
pnpm -v          # 9+
test -z "${ONEGAME_ENGINE_CDN_BASE:-}"

WORKDIR=work/<runId>/game
mkdir -p "$WORKDIR"
cd "$WORKDIR"
# 此时不得有 instruction.md / .git / package.json

npx -y @1game/cli@1.23.0 init .
pnpm install
pnpm exec 1game-skill activate --cursor --force

# pin 闸：package.json 中下列必须恰好 "1.23.0"
# @1game/cli  @1game/engine-bundle  @1game/cli-1gameplay  @1game/skill

# 然后复制 instruction.md（仅题面）
```

`1game init` 允许预先存在的只有：`.cursor` `.agents` `.claude` `.DS_Store`。  
**禁止**为通过检查而 `mv .cursor`。init **不会** `git init`。  
正确顺序：空目录 → `init` → `pnpm install` → `activate --cursor --force` → **再写入** `instruction.md`。

npm train `1.23.0` 在缺少 `options.bindStore` 时 **create 直接失败**。流水线把该错误映射为 `BINDSTORE_EMPTY`（与「create 后 `store:state` 非对象」同一 primary）。

升级到 `1.23.0` 后须在新工作区重新 create 归档；旧版本归档不能与新版本回放壳混用。带输入事件的 step 默认执行渲染绑定检查，发现 `CHECK_RENDER_MISMATCH` 时退出码为 7，适配器按重放失败处理；不要关闭检查来通过评测。流水线使用单分支归档和 `--at last`，不依赖多分支的路径序号。

激活默认全部 `1game-*`。不要 `--skill` 子集。不要第二次 `init`。instruction **覆盖** skill Quick Start。

## 评测仓命令

在 `eval/pipeline`：

```bash
pnpm install
pnpm test                 # 合同/审计/Judge 子集/报表禁令
# Kenney CC0 四包已在 eval/assets/library。要重拉：node scripts/fetch-kenney.mjs
pnpm run test-negatives   # P0 负例
pnpm run run-p1-compare   # headline × 两引擎：builder / debug / replay / looks，再写 COMPARE_SCALAR.json
pnpm run run-product-100 -- --run-id <id>          # 同上。主进程套公式。Cloud Agent 内默认用当前 subagent 当 builder / debug / looks
node src/cli.mjs emit-scoreboard --run-id <id>     # 只用 PRODUCT_100.json 重出分数页（模板固定，加题加引擎只扩数据）
# 禁止用内置 worker 冒充 subagent。EVAL_LOOKS_ALLOW_WORKER=1 仅调试。EVAL_LOOKS_BACKEND=heuristic 仅调试。
node src/cli.mjs looks-prompt --job work/<run>/looks/looks-request.json
node src/cli.mjs apply-looks --verdict work/<run>/looks/looks-verdict.json
```

不要打开本仓当 Builder 工作区。本仓不提供可抄的成品。

### 阶段预算与运行记录

Builder、debug、looks 默认各 600000 ms（10 分钟）；replay 默认 1800000 ms（30 分钟）。可分别设置 `EVAL_BUILDER_TIMEOUT_MS`、`EVAL_DEBUG_TIMEOUT_MS`、`EVAL_REPLAY_TIMEOUT_MS`、`EVAL_LOOKS_TIMEOUT_MS`。阶段配置优先于旧的统一配置 `EVAL_SUBAGENT_TIMEOUT_MS`，然后才使用默认值；配置必须是正整数毫秒，最大 2147483647。阶段超时会报告 `BUILDER_TIMEOUT` / `DEBUG_TIMEOUT` / `REPLAY_TIMEOUT` / `LOOKS_TIMEOUT`。

依赖仍只用 pnpm 安装。1Game 校验、步进、查询和截图直接以当前 Node 启动游戏工作区 `node_modules/@1game/cli-1gameplay` 声明的 CLI，先确认包名和版本 `1.23.0`。不搜索全局或上级目录中的 CLI。输入参数、33 ms 步进、抽帧频率、1280×720 截图和原有 argv 审计保持一致。

`run-product-100` 在启动时生成 `PRODUCT_100.json`、`COMPARE_SCALAR.json`、`RUN_STATE.json` 和成绩页，`status` 为 `RUNNING`；每题结束后原子更新这些文件，并保存 `tasks/<taskId>/RESULT.json`。结束时状态为 `COMPLETE`；发生阶段异常时记录 `FAILED`，命令退出码为 1。单侧阶段异常被隔离，另一侧和后续题继续执行。各引擎输出目录保存真实裁决 `LOOKS.json` 和阶段错误 `STAGE_ERROR.json`；`REPLAY.json` 仍只由 `stage-replay` 写出。

未执行、超时或未通过重放可信性检查的项，`G` 和题分为 `null`，不按游戏的 `G=0` 计零分。可信重放证明的启动失败或无成功轨迹仍遵循既有 G=0 规则。任一题证据未齐或结果不可比时，两侧套件平均分均留空，不宣布胜者。文件是同一次执行的进度记录，不提供补跑、自动重试或续评入口。`run-p1-compare` 同样逐题保存过程报告并隔离阶段异常。

## 计分

**胜负：可比的 `product_100`。** 每题 \(S = G \times (15M + 35D + 15V + 35A)\)。\(G=0\) 则该题 0，仍占套件等权一份。\(G\) 定义为能启动，且至少一条合法 submitted trace 重放成功。缺了题目要求的场景时该题仍出分：只作用于那些场景的条目为 0，贯穿条目把缺场景按 0 算进平均。行上写出 `missing_scenarios`。M、D、V、A 只来自本次 looks subagent。每条须带静帧 id，否则整份证据不全，套件分留空。只属于一个场景的条目取最高分，贯穿条目取平均。一边能启动、另一边不能时，启动的那边仍必须有 subagent 裁决。任一题不可比，套件分留空。

过程：P0 夹具五个 0/1 **create_ok / replay_ok / store_match / argv_ok / hygiene_ok** 与 headline `COMPARE_SCALAR`。禁止把它们写进谁赢的句子。

Headline：`p1-chart-rush`（谱面节奏）、`p1-depot-skirmish`（回合制小队战）、`p1-tower-defense`（固定路径塔防）。`p1-slide-puzzle` 不计入套件分。P0 四题只作过程夹具。分数页模板在 `eval/pipeline/src/scoreboard.template.html`：目录是「引擎名 + 分数」，正文一题一张大卡片；`engines[]` / `task_ids[]` 变长时版式不变。

## 本仓不包含

像素金标、Playwright、Chromium、Rapier、Harbor、公开 npm 包、`whats-new` 写作、`1game-engine` 链接、把 napi-canvas 静帧与 Xvfb **视频**合成同一视觉分。观感只使用两边 1280×720 **静帧**。
