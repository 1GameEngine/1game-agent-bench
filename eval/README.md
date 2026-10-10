# 1Game × Godot LLM 生成游戏评测（eval-spec/1）

私有评测产品。不要发到 npm，不要做成 `1game-*` skill。

**当前里程碑：product_100。** 跨引擎谁赢只看 **headline 题等权平均的百分制** `product_100`（谱面冲刺、货仓交火、塔防）。结论句只引用这些题的套件分。

过程指标仍产出、不决定胜负：P0 四题五维表（夹具，不进 headline）、`COMPARE_SCALAR = TRACE_OK / ATTEMPTS`。禁止 `overall` / `total_score` / `vlm_*`。

Headline 在 `compare_tasks`：`p1-chart-rush`、`p1-depot-skirmish`、`p1-tower-defense`。`p1-slide-puzzle` 仍可加载，不进套件分。本仓不带参考作。

Godot 安装见 [`INSTALL-godot.md`](INSTALL-godot.md)。Builder 提示：[`builder.prompt.p1.onegame.md`](builder.prompt.p1.onegame.md) 与 [`builder.prompt.p1.godot.md`](builder.prompt.p1.godot.md)（仅附录 A 不同）。

实现说明是题面 `instruction.md`，末尾拼上 `tasks/_shared/constraints.md`。隐藏量表在 `tasks/<id>/judge/rubric.json`，Builder 不可见。题目不再带 `probe.json`。本仓没有 `examples/`，也没有可照抄的参考作。`run-oracles` 与默认的 `run-oracle-gate` 以 `NO_REFERENCE` 停止。每次 `run-product-100` / `run-p1-compare` 都按引擎拆成 builder、debug、replay、looks 四个 subagent。在 Cloud Agent 里（`CURSOR_AGENT=1`）不需要 `EVAL_SUBAGENT_CMD`：builder、debug 和 looks 默认交给当前 Cloud Agent 的 subagent，请求落在 `work/.cloud-agent-tasks/*.request.json`，回应写成同名 `.response.json`（`{"stdout":"","exitCode":0}`）。重放由适配器执行 `stage-replay`，主进程不手写 `REPLAY.json`。打开 worker / heuristic 不出百分制。不在 Cloud Agent 里、又没设 `EVAL_SUBAGENT_CMD` 时，以 `SUBAGENT_REQUIRED` 停止。`EVAL_SUBAGENT_CMD` 仍可覆盖默认入口。

阶段入口默认是当前 Cloud Agent 的 subagent。`EVAL_SUBAGENT_CMD` 可选（cwd 为该引擎工作区，stdin 为 `{role,engine,taskId,workspace,prompt,...}`）。`role` 依次是 `builder`、`debug`、`replay`、`looks`，两边引擎互不可见。主进程不写 `game.tsx` / `game.gd`，不手写重放结果，不看图。Builder 把提交写进工作区。主进程接着审计轨迹，并做构建和一次启动校验：1Game 跑 `1gameplay create` 且 store 已绑定，Godot 做 headless import 后让主场景跑一帧。共用正文要求提交前按轨迹逐步自查，这段说明不写引擎命令。失败把错误文本交回同一个 builder，默认最多 3 次（`EVAL_BUILDER_BOOT_ATTEMPTS`），并要求按同一段自查再走一遍。静态审计在最后一次仍失败则 `BUILDER_INVALID`，不重放。启动通过后进入一轮 debug：引导只写游戏需求和 `demo_outputs` 测试用例，不写引擎命令，也不给构建日志。debug 改完再审计一次，失败则 `BUILDER_INVALID`，不重放。builder/debug 的明确自查失败保留警告，不冒充成功；提交通过独立审计和启动检查才继续正式重放。builder 的非法提交仍交回同一个 builder 修正。协议、进程、环境和超时异常仍停止该侧，不通过此路径恢复。启动仍失败则跳过 debug，进入重放，由重放记下 `BUILD_FAIL` / `BOOT_FAIL`。Replay 只能执行 `node src/cli.mjs stage-replay ...`，由该命令写出带 `via:"stage-replay"` 和本次令牌的 `REPLAY.json`；手改文件会被 `REPLAY_UNTRUSTED` 拒绝。Looks 只看这一边的静帧，M、D、V、A 四类都在这一步打完，每条带静帧 id。主进程只按场景取最高、贯穿取平均后套公式，不再用探针，也不做跨条目封顶。`EVAL_BUILDER_CMD` 只留给单独的模型写盘试验，headline 跑分不走它。

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

Cloud Agent 的模型阶段使用 `eval.cloud-stage-timing/1` 开工握手：请求的 `lifecycle` 与交接正文提供 `.started.json`、`.response.json`、`.timing.json` 路径。实际阶段代理开始时原子写入 `{"id":"本请求ID","started_at":"当前UTC ISO时间"}`，主代理不能提前代写。开工前确认派发截止未过且计时记录仍为 `QUEUED`。执行预算从真实开工时间开始，等待派发独立计时；`EVAL_DISPATCH_TIMEOUT_MS` 默认 600000 ms，使用相同正整数校验，不受旧的统一执行预算覆盖。等待超时为 `BUILDER_DISPATCH_TIMEOUT` / `DEBUG_DISPATCH_TIMEOUT` / `LOOKS_DISPATCH_TIMEOUT`；实际执行超时保持上述原有名称。未开工、过期或错误请求 ID 的回执不会当作成功。

`.timing.json` 保留请求时间、派发截止、真实开工时间、执行截止、等待及执行耗时和最终状态，成功时清理请求/开工/结果回执，失败时保留它们供排查。旧交接方必须增加真实开工回执；仅写结果回执不再有效。replay 与直接子进程入口仍从进程启动计算执行预算。

原子开工回执发布后即可调用可信验证或发布入口，无须等待主循环下一次轮询。计时状态尚为 `QUEUED` 时，入口使用与主循环相同的规则检查真实开工回执与派发截止，并推导执行截止；不改写计时文件。缺失、伪造、迟到的开工回执和已失败请求仍拒绝。

回执按文件实际发布时间验收：读取同一文件描述符的内容和元数据，用 `ctime` 与 `mtime` 的较晚者判断，防止临时文件预写或回填 `mtime` 把迟到回执变成按时。截止前发布、截止后才轮询到的回执仍有效；截止时或之后发布仍超时。计时记录额外保留 `response_published_at`、`response_observed_at`；已收到合法及时回执时，`finished_at` 和执行耗时按发布时间记录。开工回执同样检查实际发布未超过派发截止。

交接预留执行预算的 10%（最多 60 秒）归档和回报，包含在原预算内。`wrap_up_at` 是停止追加修改和准备回报的提醒，不是验证失效的时间；已经启动的最终验证可在收尾期前半段完成。Cloud Agent 的验证 argv 带 `--stage-timing`，可信入口读取该请求的真实执行截止；在收尾预留后半段开始时（默认截止前 30 秒）自动终止整个验证进程组，并等待子进程退出。先 SIGTERM，最多 5 秒后 SIGKILL，最多再等 2 秒确认清理；环境异常或清理失败不伪装为自查警告。太晚启动不再拉起验证进程，自动停止的验证输出诊断 `validation_incomplete`，不发布成功阶段回执，不写正式 REPLAY.json。验证成功仍须代理查看静帧、判断题面行为。

最终回报前停止并等待其他可能改动提交或证据的后台进程。将真实结果 JSON 写进自己的文件，再执行交接里的 `response_publish_argv` 并追加 `--input <JSON路径>`；`publish-stage-response` 先原子写 `archive_response_path`，再原子发布相同结果，拒绝过期、无效和重复发布。可加 `--archive <额外路径>` 同时保存交接要求的副本。框架成功清理回执时保留归档。这个入口不代替代理判断成功或生成裁决。

统一验证监管在 worker 退出时启动后代进程清理，再等待输出管道关闭并收集完整结果；后代继承输出管道不会把已经完成的验证拖到截止时间或误标成未完成。

自查未完成或玩法自查失败使用非零 `exitCode`，并附 `failure:{kind:"validation_incomplete"|"game_validation_failed",message:"具体问题"}`。框架分别记录 `STAGE_VALIDATION_INCOMPLETE` / `GAME_VALIDATION_FAILED`，保留失败计时和回执，并独立检查提交；通过后记入 `STAGE_WARNINGS.json` 以及报告的 `stage_warnings`，继续正式评测。未分类的非零回报为 `SUBAGENT_FAILED`，子进程异常为 `SUBAGENT_PROCESS_FAILED`，非法回执为 `SUBAGENT_INVALID`；这些与超时不能作为自查警告恢复。不改变计分公式或追溯重算旧结果。

Builder/debug 交接包含 `validation.argv`，统一入口为 `node src/cli.mjs validate-traces --engine <onegame|godot> --task <id> --workspace <自己的工作区>`；可加 `--scenario <演示名>` 单独排查。允许执行该可信入口，不读取它的评测实现。入口只加载公开 task.yaml，在独立副本中复用正式输入和 30fps 时序，输出起止静帧与 `VALIDATION.json`，不加载隐藏量表、不写正式 REPLAY.json、不打分。成功仅证明轨迹可执行，终局与玩法仍需对照题面检查；不要另写底层 host 输入注入器。每个 scenario 恰好一条轨迹；允许事件写在题面末尾，拖拽题明确包含 mouse_down/mouse_move/mouse_up。

依赖仍只用 pnpm 安装。1Game 校验、步进、查询和截图直接以当前 Node 启动游戏工作区 `node_modules/@1game/cli-1gameplay` 声明的 CLI，先确认包名和版本 `1.23.0`。不搜索全局或上级目录中的 CLI。Headline 每帧推进精确的 1000/30 ms，两边输入在该帧推进前注入且不额外消耗时间；P0 保持 16 ms 与原有 argv 审计。抽帧频率和 1280×720 截图保持一致。

Godot headline 使用完整原生固定帧，物理与脚本各推进一次，Timer、Tween、AnimationPlayer 和按键 pressed/released 边沿随帧更新。帧输入在物理处理前注入，渲染完成后冻结场景和时钟，截图等待不推进玩法。无论只截起止帧、正式抽帧或不保存 PNG，使用同一帧驱动；需要 `xvfb-run` 或 X11 `DISPLAY`，缺失时报告环境错误。

`run-product-100` 在启动时生成 `PRODUCT_100.json`、`COMPARE_SCALAR.json`、`RUN_STATE.json` 和成绩页，`status` 为 `RUNNING`；每题结束后原子更新这些文件，并保存 `tasks/<taskId>/RESULT.json`。结束时状态为 `COMPLETE`；发生阶段异常时记录 `FAILED`，命令退出码为 1。单侧阶段异常被隔离，另一侧和后续题继续执行。各引擎输出目录保存真实裁决 `LOOKS.json` 和阶段错误 `STAGE_ERROR.json`；`REPLAY.json` 仍只由 `stage-replay` 写出。

未执行、超时或未通过重放可信性检查的项，`G` 和题分为 `null`，不按游戏的 `G=0` 计零分。可信重放证明的启动失败或无成功轨迹仍遵循既有 G=0 规则。任一题证据未齐或结果不可比时，两侧套件平均分均留空，不宣布胜者。文件是同一次执行的进度记录，不提供补跑、自动重试或续评入口。`run-p1-compare` 同样逐题保存过程报告并隔离阶段异常。

## 计分

当前规则修订为 `product-100/2`，新报告记录 `scoring_policy_revision`。旧报告、轨迹和裁决保持原样，不追溯重算；不同修订的分数不能直接比较。

M/D 按题面可见行为评分，不因采用文字或几何图形统一封顶。题面明确要求的对象素材仍由相应条目检查。谱面冲刺 V2/V3 只对游玩阶段取静帧平均：looks 为每个静帧提供共享 `frame_contexts`（title/countdown/play/result/unreadable），仅清楚的标题、倒计时和结算帧可排除；游玩空场和不可读帧仍按 0 计入。未进入游玩得 0，漏帧或均值不符为证据不完整。其他 V 条目仍平均全部静帧。场景隔离与跨场景条目平均保持现有规则。

**胜负：可比的 `product_100`。** 每题 \(S = G \times (15M + 35D + 15V + 35A)\)。\(G=0\) 则该题 0，仍占套件等权一份。\(G\) 定义为能启动，且至少一条合法 submitted trace 重放成功。缺了题目要求的场景时该题仍出分：只作用于那些场景的条目为 0，贯穿条目把缺场景按 0 算进平均。行上写出 `missing_scenarios`。M、D、V、A 只来自本次 looks subagent。每条须带静帧 id，否则整份证据不全，套件分留空。只属于一个场景的条目取最高分，贯穿条目取平均。一边能启动、另一边不能时，启动的那边仍必须有 subagent 裁决。任一题不可比，套件分留空。

过程：P0 夹具五个 0/1 **create_ok / replay_ok / store_match / argv_ok / hygiene_ok** 与 headline `COMPARE_SCALAR`。禁止把它们写进谁赢的句子。

Headline：`p1-chart-rush`（谱面节奏）、`p1-depot-skirmish`（回合制小队战）、`p1-tower-defense`（固定路径塔防）。`p1-slide-puzzle` 不计入套件分。P0 四题只作过程夹具。分数页模板在 `eval/pipeline/src/scoreboard.template.html`：目录是「引擎名 + 分数」，正文一题一张大卡片；`engines[]` / `task_ids[]` 变长时版式不变。

## 本仓不包含

像素金标、Playwright、Chromium、Rapier、Harbor、公开 npm 包、`whats-new` 写作、`1game-engine` 链接、把 napi-canvas 静帧与 Xvfb **视频**合成同一视觉分。观感只使用两边 1280×720 **静帧**。
