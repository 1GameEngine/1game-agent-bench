# Godot 4.4.x（dump + 1280×720 静帧）

机械正确性仍跑 **headless dump**。场景、点击、观感视窗都是 **1280×720**。EvalRunner 从专用 SubViewport 出 PNG，避免 root/Dummy 空纹理。Xvfb 单帧（`--screen 1280x720`），不是录像。

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

`dt_ms = 16`。Harness 每次 tick 对场景树调用 `_process(0.016)`。禁止 16.666 与 16 混用，禁止墙钟 `wait`。

点击：同一仿真步注入 `InputEventMouseButton` press+release，然后 `post_ticks: 1`。

## EvalProbe

单例名 `EvalProbe`，`dump() -> Dictionary`。Harness 在工程中 **注入/覆盖** `eval_injected/EvalProbe.gd`。Builder **不要**自己实现 EvalProbe。树里已有同名且哈希不符 → `INJECT_TAMPER`。

Freeze：最后一条闭集动作 + `post_ticks` → `get_tree().paused = true` → dump。

## 附录 A（Godot 状态容器）

把题面字段做成 **当前主场景根节点脚本上的同名变量**（`bool` / `int` / 闭集字符串）。注入的 EvalProbe 只 `get` 这些字段。不要读 playplan/checkpoint 文件。
