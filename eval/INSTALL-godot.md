# Godot 4.4.x（P0 dump 夹具 + P1 30fps traces 抽帧）

P0 夹具机械正确性仍跑 **headless dump**。Headline 改为 **submitted traces 30fps 重放抽帧**（`frame_dt=1.0/30.0`），隐藏量表打 M/D/V/A。场景、点击、观感视窗都是 **1280×720**。EvalRunner 从专用 SubViewport 出 PNG。Xvfb 单帧（`--screen 1280x720`），不是录像。

两边都 `G=1` 的题若只有一侧有静帧，V/A 成对记 `INCOMPARABLE_VISUAL`（两边都 0），套件 `comparable=false`，不得宣布胜者。

点击坐标是题面 1280×720。谁赢只引用 `product_100`，不引用 VLM 原始字段。

## 二进制

需要官方 **Godot 4.4.1** Linux x86_64 编辑器（`--headless` 即可，不必另下 export template 做 P0/P1 dump）。

```bash
mkdir -p eval/tools/godot
curl -L -o /tmp/godot.zip \
  https://github.com/godotengine/godot-builds/releases/download/4.4.1-stable/Godot_v4.4.1-stable_linux.x86_64.zip
unzip -o /tmp/godot.zip -d eval/tools/godot
chmod +x eval/tools/godot/Godot_v4.4.1-stable_linux.x86_64
eval/tools/godot/Godot_v4.4.1-stable_linux.x86_64 --version
# 期望 4.4.1.stable
```

覆盖路径：环境变量 `GODOT_BIN`。

本仓 **不提交** 该 ~120MB 二进制。

## 时钟

`dt_ms = 16` 只约束 P0 夹具。Harness 对 P0 每次 tick 调用 `_process(0.016)`。Headline traces 用 `--fixed-fps 30` 和每秒 30 次物理更新推进完整原生帧；脚本、Timer、Tween、AnimationPlayer 和输入边沿状态共享同一个时钟。禁止墙钟 `wait`。

点击：同一仿真步注入 `InputEventMouseButton` press+release，然后 `post_ticks: 1`。

## EvalProbe

单例名 `EvalProbe`，`dump() -> Dictionary`。Harness 在工程中 **注入/覆盖** `eval_injected/EvalProbe.gd`。Builder **不要**自己实现 EvalProbe。树里已有同名且哈希不符 → `INJECT_TAMPER`。

Freeze：最后一条闭集动作 + `post_ticks` → `get_tree().paused = true` → dump。

## 附录 A（Godot 状态容器）

把题面字段做成 **当前主场景根节点脚本上的同名变量**（`bool` / `int` / 闭集字符串）。注入的 EvalProbe 只 `get` 这些字段。不要读 playplan/checkpoint 文件。

Headline 每帧在物理处理开始前经标准 Input 管线注入输入，待物理、脚本、计时器、动画和渲染完成后冻结场景与时钟。截图和场景重载等待不增加游戏时间，包括默认持续运行的 SceneTreeTimer；显式 always/when-paused 节点在等待期间暂时禁用，推进时恢复原模式。同步鼠标位置、按键状态，支持根节点、子节点和 GUI 的输入处理；同帧点击按下、松开不消耗额外时间。自查与正式重放仅抽帧频率不同，玩法进度相同。

原生帧推进需要渲染完成信号，即使不保存 PNG 也使用 X11 渲染器。云环境使用 `xvfb-run`；也可使用已有的 X11 `DISPLAY`。二者都不可用时报告环境错误，不回退为手动脚本调用。
