# 1Game × Godot LLM 生成游戏评测（eval-spec/1）

私有评测产品。不要发到 npm，不要做成 `1game-*` skill。

**当前里程碑：P0。** 报表前缀 `P0_`，`headline_track: none`，**不可与 Godot 对比**，禁止 `overall` / `total_score`。P1 / Godot / `COMPARE_SCALAR` 未授权，不要实现、不要写进 P0 报表。

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
| 场景 | 恰好 1 个 `<scene>`，320×180 |
| 点击 | scene 逻辑像素；评测点 geometry 命名区中心（或 playplan 写死中心） |
| Judge | 只 `1gameplay frame query --select store:state`；不读图；不用 Chromium |
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
pnpm run run-oracles      # 第 5 节 init + 四份人手 oracle，期望五维全 1
pnpm run test-negatives   # BINDSTORE_EMPTY / --ms 3008 / 改 skill / overall
```

不要打开本仓当 Builder 工作区。Oracle 只用于验收流水线。

## 计分

每题五个 0/1：**create_ok / replay_ok / store_match / argv_ok / hygiene_ok**。禁止求和、禁止加权、禁止 headline。题通过 ⇔ 五者皆 1。套件：`passed_tasks / 4` + 四题五维表。

P0 四题：`p0-click-score` `p0-hud-start` `p0-grid-marks` `p0-countdown-play`。全绿也 **不是** 宣传 1Game vs Godot 的条件。

## 本仓不包含

像素金标、Playwright、Chromium、Rapier、Godot harness、Harbor、公开 npm 包、`whats-new` 写作、`1game-engine` 链接。
