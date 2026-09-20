标题：开局街机

做一个 1280×720 的街机微游戏。先按 Start 进入倒计时，时间走完才能得分。

玩家体验：
- 开局停在 ready，Start 按钮文案必须是 Start。点中后进入 countdown，remainMs 变成 3000。
- countdown 期间每帧减少 remainMs；到 0 时 phase 变成 playing，底部得分区变亮。
- 只有 playing 时点底部 play 区 score 加 1；ready 或 countdown 时点 play 区不得加分。
- 只有 playing 时按 Space，pulses 加 1。
- 点 dead 区不得改状态。ready 时走时钟不得自行进入 countdown。
- 顶部状态条必须能读出 phase、remainMs、score、pulses。

状态字段：
- phase: 只能是 ready、countdown 或 playing，初始 ready
- remainMs: 整数，初始 0
- score: 整数，初始 0
- pulses: 整数，初始 0

- `start`: x=440, y=200, w=400, h=160 文案 "Start"
- `play`: x=0, y=480, w=1280, h=240
- `dead`: x=0, y=0, w=200, h=80

## 实现约束

- 画面逻辑尺寸 1280×720。
- 可点控件必须覆盖下列矩形（左上角 x,y 与宽高）；按钮文案必须与 labels 完全一致。
- 状态字段名与类型必须与题面一致。
- 禁止随机；禁止用物理决定对错。
- 不要实现评测探测接口；不要读取 playplan 或 checkpoint 文件。
