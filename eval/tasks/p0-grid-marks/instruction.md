标题：三格标记

做一个 320×180 的小游戏。

状态字段名必须是：
- cells: 长度为 3 的字符串数组，初始 ["","",""]
- turn: 字符串，只能是 "X" 或 "O"，初始 "X"

横排三格，每格 80×80，左上角分别是 (20,50)、(120,50)、(220,50)。
点击空格时：把当前 turn 写入该格，然后切换 turn（X→O，O→X）。
第一次成功点击写 "X"，第二次 "O"，第三次 "X"。
禁止随机。已有标记的格子再点不得覆盖（本评测不会点已填格）。

不要物理，不要第二个场景。

## 实现约束

- 恰好一个 `<scene width={320} height={180}>`。
- `const store = createGameStore({...}); renderGame(root, { bindStore: store });`
- 玩法状态只放 store；用 `store.commitChange`（或文档中的等价 commit）更新。
- 禁止 `Math.random`、`Date.now` 作为玩法输入；禁止物理包；禁止第二个 scene。
- 可点击控件须有按下态（skill 要求；**不进 checkpoint**）。
- 不要实现评测探测 API；不要读取任何 checkpoint 文件。
