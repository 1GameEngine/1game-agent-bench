# 1Game × Godot LLM 生成游戏评测（eval-spec/1）

私有评测产品。不要发到 npm，不要做成 `1game-*` skill。

**当前里程碑：product_100。** 跨引擎谁赢只看 **headline 题等权平均的百分制** `product_100`（目前仅谱面冲刺）。结论句只引用两个套件分。

过程指标仍产出、不决定胜负：P0 四题五维表（夹具，不进 headline）、`COMPARE_SCALAR = TRACE_OK / ATTEMPTS`。禁止 `overall` / `total_score` / `vlm_*`。

Headline 在 `compare_tasks`：`p1-chart-rush`。P0 四题仍可 `run-oracles`，只作过程/负例夹具。

Godot 安装见 [`INSTALL-godot.md`](INSTALL-godot.md)。Builder 提示：[`builder.prompt.p1.onegame.md`](builder.prompt.p1.onegame.md) 与 [`builder.prompt.p1.godot.md`](builder.prompt.p1.godot.md)（仅附录 A 不同）。

实现 SSOT 是题面 `instruction.md`。隐藏量表在 `tasks/<id>/judge/rubric.json`，机械断言在 `tasks/<id>/judge/probe.json`，Builder 不可见。Headline 的游戏工程和 traces **不入库**，流水线里也没有内嵌成品。每次 `run-product-100` / `run-p1-compare` 都按引擎拆成三个 subagent，主进程只准备空工作区并在最后套公式。不支持 `--looks` 或 `--mech`，也不把机械结果存进仓库再续评。

阶段入口是 `EVAL_SUBAGENT_CMD`（cwd 为该引擎工作区，stdin 为 `{role,engine,taskId,workspace,prompt,...}`）。`role` 依次是 `builder`、`replay`、`looks`，两边引擎互不可见。未设置时以 `SUBAGENT_REQUIRED` 停止，主进程不写 `game.tsx` / `game.gd`，不重放，不看图。Builder 把提交写进工作区。Replay 只能执行 `node src/cli.mjs stage-replay ...`，由该命令写出带 `via:"stage-replay"` 和本次令牌的 `REPLAY.json`；手改文件会被 `REPLAY_UNTRUSTED` 拒绝。Looks 只看这一边的静帧和观感条目，每条带静帧 id。主进程用隐藏探针算 M/D，用观感结论算 V/A，再套同一公式和 V2/A2 闸门。`EVAL_BUILDER_CMD` 只留给单独的模型写盘试验，headline 跑分不走它。

评测重放的是这次写出的 traces（`demo_outputs/*.json`，`eval.trace/1`，30fps）。缺 intro/loop/fail/clear（含空 fail/clear，或锚点项为 0）则 M、D 封顶 0.5。**循环核心看不见（V2=0）时 M、D 同样封顶 0.5**；本题 V 取 V1 与 V2 的低值，A2=0 时 A 封顶 0.5。G 要求启动成功且全部合法 traces 重放完成。没有 subagent 时不出百分制。

## 读者与隔离

- 实现方看不到 `1game-engine` 源码；只使用公开 npm train **`1.21.0`**。
- Builder 的 Cursor **只打开** `work/<runId>/game`，不要把本 `eval/` 仓加进同一 workspace。
- Judge 是本仓另一个 Node 进程。
- 不要把 rubric / 官方 traces 复制进 Builder 工作区当答案；oracle 仅验收流水线。
- 禁止 `1game-skill activate --global` 与 `npx skills add`。

Linux 同用户同 VM **不是密封**。残余风险见 `PROCESS.md`。不要对外声称已密封。

## 运行时钉死（P0）

| 项 | 值 |
|---|---|
| Node | ≥ 20 |
| 包管理器 | **只允许 pnpm 9+**（装依赖不要混用 npm） |
| 公开 train | `1.21.0` 精确字符串，无 `^` |
| 必须同版本 | `@1game/cli` `@1game/engine-bundle` `@1game/cli-1gameplay` `@1game/skill` |
| 游戏入口 | `src/game.tsx` |
| 场景 | 恰好 1 个 `<scene>`，1280×720 |
| 点击 | scene 逻辑像素；评测点 geometry 命名区中心（或 playplan 写死中心） |
| Judge（正确性） | Headline：提交 traces 重放抽帧 + 隐藏量表。P0 夹具仍只 `1gameplay frame query --select store:state`。不用 Chromium |
| Capture（观感） | 重放抽帧 1280×720 PNG。Capture **不是** 单独的机械金标。 |
| Looks（V/A） | 每引擎一个 looks subagent，只看该边静帧。worker / heuristic 不得当 headline。 |
| Replay | Replay subagent 只能跑 `stage-replay`。Headline 30fps submitted traces，sample 2fps，单条最长 20s。禁用 `--until` |

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

npx -y @1game/cli@1.21.0 init .
pnpm install
pnpm exec 1game-skill activate --cursor --force

# pin 闸：package.json 中下列必须恰好 "1.21.0"
# @1game/cli  @1game/engine-bundle  @1game/cli-1gameplay  @1game/skill

# 然后复制 instruction.md（仅题面）
```

`1game init` 允许预先存在的只有：`.cursor` `.agents` `.claude` `.DS_Store`。  
**禁止**为通过检查而 `mv .cursor`。init **不会** `git init`。  
正确顺序：空目录 → `init` → `pnpm install` → `activate --cursor --force` → **再写入** `instruction.md`。

npm train `1.21.0` 在缺少 `options.bindStore` 时 **create 直接失败**。流水线把该错误映射为 `BINDSTORE_EMPTY`（与「create 后 `store:state` 非对象」同一 primary）。

激活默认全部 `1game-*`。不要 `--skill` 子集。不要第二次 `init`。instruction **覆盖** skill Quick Start。

## 评测仓命令

在 `eval/pipeline`：

```bash
pnpm install
pnpm test                 # 合同/审计/Judge 子集/报表禁令
# Kenney CC0 四包已在 eval/assets/library。要重拉：node scripts/fetch-kenney.mjs
pnpm run run-oracles      # P0 四份 oracle，五维全 1
pnpm run test-negatives   # P0 负例
pnpm run run-p1-compare   # headline × 两引擎：builder / replay / looks 三个 subagent，再写 COMPARE_SCALAR.json
pnpm run run-product-100 -- --run-id <id>          # 同上三个 subagent。主进程套公式。未配置 EVAL_SUBAGENT_CMD 时 SUBAGENT_REQUIRED
node src/cli.mjs emit-scoreboard --run-id <id>     # 只用 PRODUCT_100.json 重出分数页（模板固定，加题加引擎只扩数据）
# 禁止用内置 worker 冒充 subagent。EVAL_LOOKS_ALLOW_WORKER=1 仅调试。EVAL_LOOKS_BACKEND=heuristic 仅调试。
node src/cli.mjs looks-prompt --job work/<run>/looks/looks-request.json
node src/cli.mjs apply-looks --verdict work/<run>/looks/looks-verdict.json
```

不要打开本仓当 Builder 工作区。Oracle 只用于验收流水线。

## 计分

**胜负：可比的 `product_100`。** 每题 \(S = G \times (40M + 10D + 20V + 30A)\)。\(G=0\) 则该题 0，仍占套件等权一份。\(G\) 定义为能启动、至少一条合法 submitted trace、且全部合法 traces 重放完成。M/D 来自隐藏 `probe.json`（抽帧时刻的状态断言，条目 0/1，维度保留加权平均）。V/A 来自隐藏量表的观感条：**每个 scenario 单独 looks-job**，由 **同一真实 looks subagent** 打 2fps 抽帧（每条最多 40 张），每条须带本 job 静帧 id，否则该条为 0。fail/clear 锚点为 0 或空操作 fail/clear 视为缺场景，M、D 封顶 0.5。**循环核心看不见（V2=0）时 M、D 同样封顶 0.5**；本题 V 取 V1 与 V2 的低值，A2=0 时 A 封顶 0.5。M&lt;0.5 时 A 贡献再封顶 0.5。总分相同但四维不一致时不宣布并列。`looks_source` 不是 `subagent` 时 V/A 留空，`product_100` 为空。两边都 `G=1` 时必须抽帧成对、job 数与 `sample_policy` 相同、`looks_source=subagent`。

过程：P0 夹具五个 0/1 **create_ok / replay_ok / store_match / argv_ok / hygiene_ok** 与 headline `COMPARE_SCALAR`。禁止把它们写进谁赢的句子。

Headline：`p1-chart-rush`（谱面节奏）。P0 四题只作过程夹具。分数页模板在 `eval/pipeline/src/scoreboard.template.html`：目录是「引擎名 + 分数」，正文一题一张大卡片；`engines[]` / `task_ids[]` 变长时版式不变。

## 本仓不包含

像素金标、Playwright、Chromium、Rapier、Harbor、公开 npm 包、`whats-new` 写作、`1game-engine` 链接、把 napi-canvas 静帧与 Xvfb **视频**合成同一视觉分。观感只使用两边 1280×720 **静帧**。
