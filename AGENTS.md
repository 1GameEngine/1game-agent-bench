# 项目代理约定

先阅读 `eval/README.md`，遵守当前评测规格，保留用户已有工作。

## 「完整跑分」快捷指令

用户说「完整跑分」「完整跑下分」「再完整跑一轮分」或同义表达时，按以下约定执行。用户已明确授权为此使用独立子代理，无需再次询问是否使用子代理。

- 默认评测当前项目的三道 headline 题（谱面冲刺、货仓交火、塔防）与两个引擎（1Game、Godot），最终成绩只使用正式 `product_100`。
- 自动检查并加载已有环境配置。当前云环境每个 shell 先执行 `source /workspace/.cloud-onboarding/env.sh`，使用 pnpm 9.15.0 与 Godot 4.4.1；若配置路径不存在，先查找当前环境的启动说明。
- 使用新的唯一 run-id，保留旧跑分结果。生成内容放在忽略的 `work/` 内，不复用上一轮游戏实现。
- 在 `eval/pipeline` 异步运行 `EVAL_CLOUD_AGENT_SUBAGENT=1 node src/cli.mjs run-product-100 --run-id <新ID>`。这只开启交接，主代理必须实际派发子代理，不能只启动命令后等待。
- 仅处理本次运行的 `work/.cloud-agent-tasks/*.request.json`。每题、每引擎使用独立 builder、debug、looks 子代理；构建修正交回同一 builder。新题 builder 使用不继承父会话历史的隔离上下文。
- 将请求的 `handoff.prompt` 与必要工作区信息传给阶段代理；looks 同时获得 `handoff.file_attachments`，实际查看全部静帧，逐条引用对应静帧 ID。builder/debug 不得读取评测仓、隐藏量表、另一引擎或旧提交。主代理不写游戏源码、不看图裁决。
- 阶段代理实际开工时，先按交接里的计时协议原子写入同名 `.started.json`（请求 `id` 和当前 UTC ISO `started_at`），主代理不能代写或提前登记。派发等待与实际执行分别计时；默认各阶段派发等待最多 10 分钟，builder/debug/looks 开工后执行各最多 10 分钟。主代理按同名 `.timing.json` 的截止时间跟进；已超时的请求不能再派发或补写成功响应。
- 调试先完成依赖、构建、类型、素材和属性检查，再修改并验证最终版本的全部轨迹。完整执行交接给出的验证 argv（包含 `--stage-timing`），复用正式输入与时序，不抽取内部 host API 或另写注入器。收尾时间是提醒：停止追加修改，已运行的最终验证可在收尾期前半段结束；统一入口在后半段开始时自动停止并等待整个验证进程组，为归档回报留时间。默认截止前 30 秒开始停止，清理最多再用 7 秒。通过后不追加调整，未完整验证不能伪报成功。
- 每阶段实际完成后，将真实结果 JSON 写进自己的文件，执行交接里的 `response_publish_argv` 并追加 `--input <结果JSON路径>`；需要额外归档时加 `--archive <路径>`。入口先原子归档，再发布同名 `.response.json`，拒绝过期、无效及重复发布。builder/debug 成功为 `{"stdout":"","exitCode":0}`；looks 的 `stdout` 是真实裁决 JSON 的字符串。自查未完成或玩法自查失败使用非零 `exitCode` 和 `failure:{kind:"validation_incomplete"|"game_validation_failed",message:"具体问题"}`；环境或工具错误使用非零退出码和 stderr。回报前停止并等待其他可能改动提交或证据的后台进程。不得伪造完成响应。
- 回执是否按时以文件实际原子发布时刻判断，不以轮询读到的时刻判断；实际迟到仍超时。计时记录保留 `response_published_at` 和 `response_observed_at`，`finished_at` 与执行耗时按发布时刻计算。真实结果归档不会随成功回执清理而删除。
- builder/debug 的明确自查失败保留为警告，框架独立审计与启动检查；合法可启动提交才继续正式重放，不把自查当成评分裁决。非法 builder 提交仍交回同一 builder 修正；协议、环境与超时异常不得按自查失败绕过。
- 重放由现有适配器调用 `stage-replay`。不手写或修改 `REPLAY.json`，不用 worker、heuristic 或参考作代替正式出码与裁决。
- 遇到环境、构建、交接问题，先自主排查并在规格允许的阶段修正后继续。不得修改评分标准或绕过证据检查；真实运行失败也应如实保留，不为提高分数擅自重跑。
- 跑完后核验进程退出状态、当前 run-id 的 `PRODUCT_100.json`、`COMPARE_SCALAR.json` 与成绩页，检查题目数量、裁决证据、可比性及平均分。证据不全或结果不可比时明确报告，不能宣称有效胜者。实际子代理不可用时明确说明阻塞，不能只设置标志冒充已接入。
- 最后给出逐题分数、三题平均分、本次结果与成绩页路径。不要只给计划或测试通过数量；测试通过不代表完成正式跑分。
