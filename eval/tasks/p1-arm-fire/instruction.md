标题：先上膛再开火

做一个 1280×720 的小游戏。

状态字段：
- armed: 布尔，初始 false
- shots: 整数，初始 0

两块按钮：Arm、Fire。
点 Arm：armed 变成 true。
点 Fire：仅当 armed 为 true 时 shots 加 1 且 armed 变成 false；否则什么也不变。
点按钮以外不得改变状态。

- `arm`: x=200, y=280, w=360, h=160 文案 "Arm"
- `fire`: x=720, y=280, w=360, h=160 文案 "Fire"

## 实现约束

- 画面逻辑尺寸 1280×720。
- 可点控件必须覆盖下列矩形（左上角 x,y 与宽高）；按钮文案必须与 labels 完全一致。
- 状态字段名与类型必须与题面一致。
- 禁止随机；禁止用物理决定对错。
- 不要实现评测探测接口；不要读取 playplan 或 checkpoint 文件。
