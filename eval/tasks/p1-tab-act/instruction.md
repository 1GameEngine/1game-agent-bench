标题：分栏计数

做一个 1280×720 的小游戏。

状态字段：
- tab: 字符串，只能是 red 或 blue，初始 red
- count_red: 整数，初始 0
- count_blue: 整数，初始 0

三块按钮：Red、Blue、Act。
点 Red：tab 变成 red。点 Blue：tab 变成 blue。
点 Act：若 tab 为 red 则 count_red 加 1；若 tab 为 blue 则 count_blue 加 1。
点按钮以外不得改变状态。

- `red`: x=80, y=80, w=280, h=128 文案 "Red"
- `blue`: x=400, y=80, w=280, h=128 文案 "Blue"
- `act`: x=440, y=360, w=400, h=160 文案 "Act"

## 实现约束

- 画面逻辑尺寸 1280×720。
- 可点控件必须覆盖下列矩形（左上角 x,y 与宽高）；按钮文案必须与 labels 完全一致。
- 状态字段名与类型必须与题面一致。
- 禁止随机；禁止用物理决定对错。
- 不要实现评测探测接口；不要读取 playplan 或 checkpoint 文件。
