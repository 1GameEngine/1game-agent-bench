import { createSignal } from 'solid-js';
import {
  createGameStore,
  renderGame,
  useNodeActive,
  useNodeHover,
  type VirtualNode,
} from '@1game/engine-bundle/runtime/worker';

type GameState = {
  power: boolean;
  track: 0 | 1 | 2;
  armed: [boolean, boolean, boolean];
  shots: [number, number, number];
};

const { store, commitChange, bindStore } = createGameStore({
  power: false,
  track: 0 as 0 | 1 | 2,
  armed: [false, false, false] as [boolean, boolean, boolean],
  shots: [0, 0, 0] as [number, number, number],
} satisfies GameState);

function Btn(props: { x: number; y: number; w: number; h: number; label: string; onPress: () => void; lit?: boolean }) {
  const [node, setNode] = createSignal<VirtualNode | undefined>();
  const hover = useNodeHover(node);
  const active = useNodeActive(node);
  const bg = () => (props.lit ? '#fbbf24' : active() ? '#1d4ed8' : hover() ? '#3b82f6' : '#2563eb');
  return (
    <group key={props.label} x={props.x} y={props.y} width={props.w} height={props.h} clickable virtualNodeRef={setNode} onClick={props.onPress}>
      <node x={0} y={0} width={props.w} height={props.h} shape="roundedRect(24 24 24 24)" backgroundColor={bg()} />
      <text x={0} y={24} width={props.w} height={72} text={props.label} textAlign="center" textSize={40} textColor="#ffffff" />
    </group>
  );
}

function App() {
  return (
    <scene name="main" width={1280} height={720} backgroundColor="#0f1224">
      <text
        x={40}
        y={20}
        width={1200}
        height={72}
        text={`power=${store.power} track=${store.track} armed=${store.armed[0] ? 1 : 0}${store.armed[1] ? 1 : 0}${store.armed[2] ? 1 : 0} shots=${store.shots[0]}${store.shots[1]}${store.shots[2]}`}
        textColor="#fff"
        textSize={32}
      />
      <Btn x={80} y={120} w={240} h={100} label="Power" lit={store.power} onPress={() => commitChange('p', (d: GameState) => { d.power = !d.power; })} />
      <Btn x={360} y={120} w={160} h={100} label="0" lit={store.track === 0} onPress={() => commitChange('t0', (d: GameState) => { d.track = 0; })} />
      <Btn x={560} y={120} w={160} h={100} label="1" lit={store.track === 1} onPress={() => commitChange('t1', (d: GameState) => { d.track = 1; })} />
      <Btn x={760} y={120} w={160} h={100} label="2" lit={store.track === 2} onPress={() => commitChange('t2', (d: GameState) => { d.track = 2; })} />
      <Btn x={200} y={400} w={360} h={140} label="Arm" lit={store.armed[store.track]} onPress={() => commitChange('arm', (d: GameState) => {
        if (!d.power) return;
        const next: [boolean, boolean, boolean] = [false, false, false];
        next[d.track] = true;
        d.armed = next;
      })} />
      <Btn x={720} y={400} w={360} h={140} label="Fire" onPress={() => commitChange('fire', (d: GameState) => {
        if (!d.power || !d.armed[d.track]) return;
        const shots: [number, number, number] = [d.shots[0], d.shots[1], d.shots[2]];
        shots[d.track] += 1;
        d.shots = shots;
        const armed: [boolean, boolean, boolean] = [d.armed[0], d.armed[1], d.armed[2]];
        armed[d.track] = false;
        d.armed = armed;
      })} />
    </scene>
  );
}
renderGame(() => <App />, { bindStore });
