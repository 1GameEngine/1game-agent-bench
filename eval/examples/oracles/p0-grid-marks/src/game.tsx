import { createSignal } from 'solid-js';
import {
  createGameStore,
  renderGame,
  useNodeActive,
  useNodeHover,
  type VirtualNode,
} from '@1game/engine-bundle/runtime/worker';

type GameState = {
  cells: [string, string, string];
  turn: 'X' | 'O';
};

const CELLS = [
  { id: 0, x: 20, y: 50 },
  { id: 1, x: 120, y: 50 },
  { id: 2, x: 220, y: 50 },
] as const;

const { store, commitChange, bindStore } = createGameStore({
  cells: ['', '', ''] as [string, string, string],
  turn: 'X',
} satisfies GameState);

function Cell(props: { id: 0 | 1 | 2; x: number; y: number }) {
  const [node, setNode] = createSignal<VirtualNode | undefined>();
  const hover = useNodeHover(node);
  const active = useNodeActive(node);
  return (
    <group
      x={props.x}
      y={props.y}
      width={80}
      height={80}
      clickable
      virtualNodeRef={setNode}
      onClick={() => {
        commitChange(`mark:${props.id}`, (draft: GameState) => {
          if (draft.cells[props.id] !== '') return;
          const next: [string, string, string] = [draft.cells[0], draft.cells[1], draft.cells[2]];
          next[props.id] = draft.turn;
          draft.cells = next;
          draft.turn = draft.turn === 'X' ? 'O' : 'X';
        });
      }}
    >
      <node
        x={0}
        y={0}
        width={80}
        height={80}
        shape="roundedRect(6 6 6 6)"
        backgroundColor={active() ? '#1e3a8a' : hover() ? '#1e40af' : '#1f2937'}
      />
      <text
        x={0}
        y={24}
        width={80}
        height={32}
        text={store.cells[props.id]}
        textAlign="center"
        textSize={28}
        textColor="#f9fafb"
      />
    </group>
  );
}

function App() {
  return (
    <scene name="main" width={320} height={180} backgroundColor="#0f1224">
      <text
        x={12}
        y={8}
        width={296}
        height={24}
        text={`turn=${store.turn}`}
        textColor="#ffffff"
        textSize={16}
      />
      <Cell id={0} x={CELLS[0].x} y={CELLS[0].y} />
      <Cell id={1} x={CELLS[1].x} y={CELLS[1].y} />
      <Cell id={2} x={CELLS[2].x} y={CELLS[2].y} />
    </scene>
  );
}

renderGame(() => <App />, { bindStore });
