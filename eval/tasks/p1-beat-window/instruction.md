标题：节拍窗

做一个 1280×720 的节奏微游戏。先按 Start 倒计时，再在三个时间窗内用空格击中音符。

玩家体验：
- 开局 phase 为 ready。Start 按钮文案必须是 Start。点中后 phase 变成 countdown，remainMs 变成 3000。
- countdown 期间每帧减少 remainMs；到 0 时 phase 变成 playing，clockMs 从 0 开始累加。
- playing 时三个窗口（单位毫秒）：[0,480)、[800,1280)、[1600,2080)。窗口内且该音尚未 resolved 时按 Space：hits 加 1，score 加 1，对应 resolved 变真。否则 misses 加 1，score 不变。
- ready 或 countdown 时按 Space、点 dead，都不得改 hits/misses/score。ready 时走时钟不得自行进入 countdown。
- 三个音符格外观：当前窗口或已击中的必须与未击中且不在窗口的不同。第二与第三格底色也要能分开。
- 顶部状态条必须能读出 phase、remainMs、clockMs、hits、misses、score。

状态字段：
- phase: 只能是 ready、countdown 或 playing，初始 ready
- remainMs: 整数，初始 0
- clockMs: 整数，初始 0
- hits, misses, score: 整数，初始 0
- resolved: 三个布尔，初始全 false

- `start`: x=440, y=200, w=400, h=120 文案 "Start"
- `note0`: x=200, y=520, w=200, h=120
- `note1`: x=540, y=520, w=200, h=120
- `note2`: x=880, y=520, w=200, h=120
- `dead`: x=0, y=0, w=160, h=80

## 实现约束

- 画面逻辑尺寸 1280×720。
- 可点控件必须覆盖下列矩形（左上角 x,y 与宽高）；按钮文案必须与 labels 完全一致。
- 状态字段名与类型必须与题面一致。
- 禁止随机；禁止用物理决定对错。
- 不要实现评测探测接口；不要读取 playplan 或 checkpoint 文件。
