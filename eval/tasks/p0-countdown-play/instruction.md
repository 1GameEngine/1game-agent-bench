标题：倒计时开局

做一个 320×180 的小游戏。不要处理点击。

状态字段名必须是：
- phase: 字符串，只能是 "countdown" 或 "playing"
- remainMs: 整数

初始：phase="countdown"，remainMs=3000。

每一帧用引擎提供的时间增量减少 remainMs（禁止 setTimeout / setInterval）。
当 remainMs 减到 <= 0：remainMs 变成 0，phase 变成 "playing"。

不要物理，不要随机，不要第二个场景。

## 实现约束

- 恰好一个 `<scene width={320} height={180}>`。
- `const store = createGameStore({...}); renderGame(root, { bindStore: store });`
- 玩法状态只放 store；用 `store.commitChange`（或文档中的等价 commit）更新。
- 禁止 `Math.random`、`Date.now` 作为玩法输入；禁止物理包；禁止第二个 scene。
- 可点击控件须有按下态（skill 要求；**不进 checkpoint**）。
- 不要实现评测探测 API；不要读取任何 checkpoint 文件。
