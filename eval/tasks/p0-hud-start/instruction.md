标题：Start 按钮

做一个 320×180 的小游戏。

状态字段名必须是：
- phase: 字符串，只能是 "ready" 或 "playing"

初始：phase="ready"。

只有一块按钮可点：位置 x=110,y=70，宽 100，高 40，按钮上文字必须是 Start。
点中按钮后 phase 变成 "playing"。
点击按钮以外的区域不得改变 phase。

不要物理，不要随机，不要第二个场景。

## 实现约束

- 恰好一个 `<scene width={320} height={180}>`。
- `const store = createGameStore({...}); renderGame(root, { bindStore: store });`
- 玩法状态只放 store；用 `store.commitChange`（或文档中的等价 commit）更新。
- 禁止 `Math.random`、`Date.now` 作为玩法输入；禁止物理包；禁止第二个 scene。
- 可点击控件须有按下态（skill 要求；**不进 checkpoint**）。
- 不要实现评测探测 API；不要读取任何 checkpoint 文件。
