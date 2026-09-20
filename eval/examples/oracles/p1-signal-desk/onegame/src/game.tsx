import { createSignal } from 'solid-js';
import {
  createGameStore,
  renderGame,
  useNodeActive,
  useNodeHover,
  type VirtualNode,
} from '@1game/engine-bundle/runtime/worker';

type GameState = {
  lamp: boolean;
  channel: 'A' | 'B' | 'C';
  armed: boolean;
  shots: number;
};

const { store, commitChange, bindStore } = createGameStore({
  lamp: false,
  channel: 'A' as 'A' | 'B' | 'C',
  armed: false,
  shots: 0,
} satisfies GameState);

function Btn(props: { x: number; y: number; w: number; h: number; label: string; onPress: () => void; lit?: boolean }) {
  const [node, setNode] = createSignal<VirtualNode | undefined>();
  const hover = useNodeHover(node);
  const active = useNodeActive(node);
  const bg = () => (props.lit ? '#fbbf24' : active() ? '#1d4ed8' : hover() ? '#3b82f6' : '#2563eb');
  return (
    <group x={props.x} y={props.y} width={props.w} height={props.h} clickable virtualNodeRef={setNode} onClick={props.onPress}>
      <node x={0} y={0} width={props.w} height={props.h} shape="roundedRect(32 32 32 32)" backgroundColor={bg()} />
      <text x={0} y={32} width={props.w} height={96} text={props.label} textAlign="center" textSize={48} textColor="#ffffff" />
    </group>
  );
}

function App() {
  return (
    <scene name="main" width={1280} height={720} backgroundColor="#0f1224">
      <text
        x={48}
        y={24}
        width={1184}
        height={80}
        text={`lamp=${store.lamp} ch=${store.channel} armed=${store.armed} shots=${store.shots}`}
        textColor="#fff"
        textSize={40}
      />
      <Btn x={80} y={140} w={240} h={120} label="Toggle" lit={store.lamp} onPress={() => commitChange('t', (d: GameState) => { d.lamp = !d.lamp; })} />
      <Btn x={400} y={140} w={200} h={120} label="A" lit={store.channel === 'A'} onPress={() => commitChange('a', (d: GameState) => { d.channel = 'A'; })} />
      <Btn x={640} y={140} w={200} h={120} label="B" lit={store.channel === 'B'} onPress={() => commitChange('b', (d: GameState) => { d.channel = 'B'; })} />
      <Btn x={880} y={140} w={200} h={120} label="C" lit={store.channel === 'C'} onPress={() => commitChange('c', (d: GameState) => { d.channel = 'C'; })} />
      <Btn x={200} y={400} w={360} h={160} label="Arm" lit={store.armed} onPress={() => commitChange('arm', (d: GameState) => { d.armed = true; })} />
      <Btn x={720} y={400} w={360} h={160} label="Fire" onPress={() => commitChange('fire', (d: GameState) => { if (d.armed) { d.shots += 1; d.armed = false; } })} />
    </scene>
  );
}
renderGame(() => <App />, { bindStore });
