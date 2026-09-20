标题：双门

做一个 1280×720 的小游戏。

状态字段：
- left: 布尔，初始 false
- right: 布尔，初始 false

两块按钮：Left、Right。点 Left 使 left 为 true；点 Right 使 right 为 true。不会关回去。
点按钮以外不得改变状态。

- `left`: x=160, y=280, w=400, h=160 文案 "Left"
- `right`: x=720, y=280, w=400, h=160 文案 "Right"
- `dead`: x=0, y=0, w=160, h=120

## 实现约束

- 画面逻辑尺寸 1280×720。
- 可点控件必须覆盖下列矩形（左上角 x,y 与宽高）；按钮文案必须与 labels 完全一致。
- 状态字段名与类型必须与题面一致。
- 禁止随机；禁止用物理决定对错。
- 不要实现评测探测接口；不要读取 playplan 或 checkpoint 文件。
