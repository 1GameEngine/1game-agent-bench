# 谱面冲刺

做一个 1280×720 的四轨节奏小游戏，标题文案必须是 Chart Rush。禁止随机生成谱面。

## 开局

- 按钮 Start 矩形 (440,200,400,120)。点 Start 或按 Enter 开始。
- 开始后倒计时 3000 毫秒，然后进入 playing。

## 谱面

- 四轨按键固定为 ArrowLeft / ArrowDown / ArrowUp / ArrowRight，轨道从左到右。
- 16 个音符：第 i 个（从 0 计）在 playing 后 400×(i+1) 毫秒落到第 i%4 轨。
- 判定窗 ±132 毫秒。命中 hits+1 并消费该音符；错过窗或打错轨 misses+1。
- misses≥6 失败，画面 Chart miss。16 个音符结束后 hits≥12 通关，画面 Chart clear。

## 素材

工作区有只读 Kenney CC0 图库 `asset-library/`。本题方向键图在工程 `assets/arrow-left.png`、`arrow-down.png`、`arrow-up.png`、`arrow-right.png`（来自 `input-prompts-pixel`）。四条轨道和落下的音符用对应方向的键帽图。

## 验收会看的玩法

未开始的标题（Start + 四轨键帽）、循环里音符从轨道中段落到判定区、空放漏击失败（Chart miss）、打完通关（Chart clear）。只有底栏没有下落物，不算把谱面画出来。

## 实现约束

- 画面逻辑尺寸 1280×720，恰好一个场景。
- 禁止随机。禁止用物理引擎决定对错。
- 不要实现评测探测接口。不要读取评测仓、量表或官方操作表。
- 提交物须含可重放 traces（放在 demo_outputs，每条标明 intro / loop / fail / clear 之一）。
