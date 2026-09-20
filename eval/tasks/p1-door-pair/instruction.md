标题：双门

做一个 320×180 的小游戏。

状态字段：
- left: 布尔，初始 false
- right: 布尔，初始 false

两块按钮：Left、Right。点 Left 使 left 为 true；点 Right 使 right 为 true。不会关回去。
点按钮以外不得改变状态。

- `left`: x=40, y=70, w=100, h=40 文案 "Left"
- `right`: x=180, y=70, w=100, h=40 文案 "Right"
- `dead`: x=0, y=0, w=40, h=30

## 实现约束

- 画面逻辑尺寸 320×180。
- 可点控件必须覆盖下列矩形（左上角 x,y 与宽高）；按钮文案必须与 labels 完全一致。
- 状态字段名与类型必须与题面一致。
- 禁止随机；禁止用物理决定对错。
- 不要实现评测探测接口；不要读取 playplan 或 checkpoint 文件。
