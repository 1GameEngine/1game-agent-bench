# 1Game × Godot LLM 生成游戏评测（eval-spec/1）

私有评测产品。不要发到 npm，不要做成 `1game-*` skill。

**当前里程碑：product_100。** 跨引擎谁赢只看 **3 题等权平均的百分制** `product_100`（信号台 / 格子探路 / 开局街机）。结论句只引用两个套件分。

过程指标仍产出、不决定胜负：P0 四题五维表（夹具，不进 headline）、`COMPARE_SCALAR = CHECKPOINTS_OK / ATTEMPTS`。禁止 `overall` / `total_score` / `vlm_*`。

Headline 三题在 `compare_tasks`：`p1-signal-desk` `p1-grid-scout` `p1-ready-run`。P0 四题仍可 `run-oracles`，只作过程/负例夹具。

Godot 安装见 [`INSTALL-godot.md`](INSTALL-godot.md)。Builder 提示：[`builder.prompt.p1.onegame.md`](builder.prompt.p1.onegame.md) 与 [`builder.prompt.p1.godot.md`](builder.prompt.p1.godot.md)（仅附录 A 不同）。

实现 SSOT 是本仓合同（任务 instruction / geometry / playplan / checkpoint 原文）。缺字段停工。

## 读者与隔离

- 实现方看不到 `1game-engine` 源码；只使用公开 npm train **`1.21.0`**。
- Builder 的 Cursor **只打开** `work/<runId>/game`，不要把本 `eval/` 仓加进同一 workspace。
- Judge 是本仓另一个 Node 进程，用绝对路径读 checkpoint。
- 不要把 playplan / checkpoint 复制进 `game/`。
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
| Judge（正确性） | 只 `1gameplay frame query --select store:state`；不读图；不用 Chromium |
| Capture（观感） | `1gameplay frame screenshot` 仅 `role=capture`；**视窗锁死 1280×720**（`--width 1280 --height 720`）。Capture **不是** Judge。 |
| Looks（V/A） | 独立 looks-job：读 1280×720 静帧 + 该帧 dump。**跑分必须用真实 looks subagent**（写 `looks-verdict.json` 或 `EVAL_LOOKS_CMD` / `setLooksInvoker`）。内置 looks-job worker 只在 `EVAL_LOOKS_ALLOW_WORKER=1` 时调试，且 `looks_source=worker`，**不得当 headline**。无外部评委 → `SUBAGENT_UNAVAILABLE`，不可比。`EVAL_LOOKS_BACKEND=heuristic` 仅调试。 |
| Replay | `child_process.execFile`；整条赛道禁用 `--until` |

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
pnpm run run-oracles      # P0 四份 oracle，五维全 1
pnpm run test-negatives   # P0 负例
pnpm run run-p1-compare   # 3 题 × 两引擎 oracle → COMPARE_SCALAR.json（过程）
pnpm run run-product-100 -- --run-id <id> --mech   # 机械 + 静帧 + 写出 looks-job（不打 V/A）
# 真实 looks subagent 写入各 jobDir/looks-verdict.json 后：
pnpm run run-product-100 -- --run-id <id> --looks  # 读裁决 → PRODUCT_100.json（胜负）+ report/index.html
node src/cli.mjs emit-scoreboard --run-id <id>     # 只用已有 JSON 重出分数页（模板固定，加题加引擎只扩数据）
# 禁止用内置 worker 冒充 subagent。EVAL_LOOKS_ALLOW_WORKER=1 仅调试。EVAL_LOOKS_BACKEND=heuristic 仅调试。
node src/cli.mjs looks-prompt --job work/<run>/looks/looks-request.json
node src/cli.mjs apply-looks --verdict work/<run>/looks/looks-verdict.json
```

不要打开本仓当 Builder 工作区。Oracle 只用于验收流水线。

## 计分

**胜负：可比的 `product_100`。** 每题 \(S = G \times (40M + 10D + 20V + 30A)\)（无 D 的题把 10 分并进其余维）。\(G=0\) 则该题 0，仍占 1/3。M 来自官方 dump。V/A 来自 **同一真实 looks subagent** 打冻结静帧（不是内置 worker）。场景、点击、视窗都是 **1280×720**。两边都 `G=1` 时必须同时有 1280×720 静帧且 `looks_status=OK`、`looks_source=subagent`；否则观感成对作废，`comparable=false`，**不宣布胜者**。worker / heuristic 不得当 headline。

过程：P0 夹具五个 0/1 **create_ok / replay_ok / store_match / argv_ok / hygiene_ok** 与三题 `COMPARE_SCALAR`。禁止把它们写进谁赢的句子。

Headline 三题：`p1-signal-desk`（规则/状态）`p1-grid-scout`（空间）`p1-ready-run`（街机节奏）。P0 四题只作过程夹具。分数页模板在 `eval/pipeline/src/scoreboard.template.html`：目录是「引擎名 + 分数」，正文一题一张大卡片；`engines[]` / `task_ids[]` 变长时版式不变。

## 本仓不包含

像素金标、Playwright、Chromium、Rapier、Harbor、公开 npm 包、`whats-new` 写作、`1game-engine` 链接、把 napi-canvas 静帧与 Xvfb **视频**合成同一视觉分。观感只使用两边 1280×720 **静帧**。
