标题：点击计分

做一个 320×180 的小游戏。

状态字段名必须是：
- phase: 字符串，只能是 "ready" 或 "playing"
- score: 整数

初始：phase="ready"，score=0。

整个场景都可以点。
- 第一次点击：phase 变成 "playing"，score 保持 0。
- 之后每次点击：score 增加 1。

不要物理，不要随机，不要第二个场景。

## 实现约束

- 恰好一个 `<scene width={320} height={180}>`。
- `const store = createGameStore({...}); renderGame(root, { bindStore: store });`
- 玩法状态只放 store；用 `store.commitChange`（或文档中的等价 commit）更新。
- 禁止 `Math.random`、`Date.now` 作为玩法输入；禁止物理包；禁止第二个 scene。
- 可点击控件须有按下态（skill 要求；**不进 checkpoint**）。
- 不要实现评测探测 API；不要读取任何 checkpoint 文件。
