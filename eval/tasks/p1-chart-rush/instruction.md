# 谱面冲刺

做一个 1280×720 的四轨节奏小游戏，标题文案必须是 Chart Rush。禁止随机生成谱面。

## 开局

- 画面上半部有大按钮 Start。点 Start 或按 Enter 开始。
- 开始后先有一段大约 3 秒、能读出的倒计时，然后进入打谱。未开始时没有倒计时，也没有落下的音符。

## 谱面

- 四条轨道从左到右对应 ArrowLeft、ArrowDown、ArrowUp、ArrowRight。
- 谱面固定：16 个音符，大约每 400 毫秒一个，按左、下、上、右循环。
- 音符从轨道中段落向底部判定区，在画面上停留足够长，让人看见它在移动。
- 判定区附近打对轨算一次命中并消掉该音符；打错或错过算一次失误。
- 失误达到 6 次出现 Chart miss。16 个音符走完且命中至少 12 次出现 Chart clear。两个结局文案不能同时出现。

## 素材

工作区有只读 Kenney CC0 图库 `asset-library/`。本题方向键图在工程 `assets/arrow-left.png`、`arrow-down.png`、`arrow-up.png`、`arrow-right.png`（来自 `input-prompts-pixel`）。四条轨道和落下的音符用对应方向的键帽图。

## 验收会看的玩法

未开始的标题（Start + 四轨键帽）、循环里音符从轨道中段落到判定区、空放漏击失败（Chart miss）、打完通关（Chart clear）。只有底栏没有下落物，不算把谱面画出来。

每段演示不超过 10 秒。
