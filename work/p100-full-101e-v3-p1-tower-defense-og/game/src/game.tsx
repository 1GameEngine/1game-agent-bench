import { For, Show } from 'solid-js';
import { createGameStore, renderGame, useFrame } from '@1game/engine-bundle/runtime/worker';
import pathTile from '../assets/path.png';
import grassTile from '../assets/grass.png';
import baseTile from '../assets/base.png';
import wallImg from '../assets/wall.png';
import gunImg from '../assets/gun.png';
import cannonImg from '../assets/cannon.png';
import scoutImg from '../assets/scout.png';
import bruteImg from '../assets/brute.png';
import flyerImg from '../assets/flyer.png';
import {
  CARDS,
  CELL,
  COLS,
  MAPS,
  ROWS,
  R_BEND,
  R_LOAD,
  R_MAPS,
  R_RETRY,
  R_SAVE,
  R_START,
  R_STEP,
  R_STRAIGHT,
  R_UPGRADE,
  R_WIPE,
  cellX,
  cellY,
  currentWave,
  dpOf,
  initialState,
  isDeploy,
  keyInput,
  pointerDown,
  pointerMove,
  pointerUp,
  tick,
  type GameState,
  type Rect,
} from './logic';

const IMG: Record<string, any> = {
  gun: gunImg,
  wall: wallImg,
  cannon: cannonImg,
  scout: scoutImg,
  brute: bruteImg,
  flyer: flyerImg,
};

const { store, commitChange, bindStore } = createGameStore<GameState>(initialState());

function Button(props: { stableKey: string; rect: Rect; label: string; active: boolean; color: string }) {
  return (
    <group key={props.stableKey} x={props.rect.x} y={props.rect.y} width={props.rect.w} height={props.rect.h}>
      <node
        x={0}
        y={0}
        width={props.rect.w}
        height={props.rect.h}
        shape="roundedRect(10 10 10 10)"
        backgroundColor={props.active ? props.color : '#3a3f4b'}
      />
      <text
        x={0}
        y={0}
        width={props.rect.w}
        height={props.rect.h}
        text={props.label}
        textAlign="center"
        textVerticalAlign="middle"
        textSize="26"
        textColor={props.active ? '#ffffff' : '#8b91a0'}
      />
    </group>
  );
}

function SelectScreen() {
  return (
    <group x={0} y={0} width={1280} height={720}>
      <text x={80} y={36} width={700} height={64} text="Tower Defense" textSize="52" textAlign="left" textColor="#ffe29a" />
      <text x={80} y={110} width={400} height={36} text={`open ${store.open} / 2`} textSize="28" textAlign="left" textColor="#cfd6e6" />
      <node x={R_STRAIGHT.x} y={R_STRAIGHT.y} width={R_STRAIGHT.w} height={R_STRAIGHT.h} shape="roundedRect(14 14 14 14)" backgroundColor="#2f6b4a" />
      <text x={R_STRAIGHT.x + 30} y={R_STRAIGHT.y + 30} width={460} height={50} text="Straight" textSize="42" textColor="#ffffff" />
      <text x={R_STRAIGHT.x + 30} y={R_STRAIGHT.y + 100} width={460} height={40} text="Open" textSize="32" textColor="#c8ffd8" />
      <node
        x={R_BEND.x}
        y={R_BEND.y}
        width={R_BEND.w}
        height={R_BEND.h}
        shape="roundedRect(14 14 14 14)"
        backgroundColor={store.open >= 2 ? '#2f6b4a' : '#4a4f5c'}
      />
      <text x={R_BEND.x + 30} y={R_BEND.y + 30} width={460} height={50} text="Bend" textSize="42" textColor="#ffffff" />
      <text
        x={R_BEND.x + 30}
        y={R_BEND.y + 100}
        width={460}
        height={40}
        text={store.open >= 2 ? 'Open' : 'Locked'}
        textSize="32"
        textColor={store.open >= 2 ? '#c8ffd8' : '#ffb0a8'}
      />
      <Button stableKey="btn-save" rect={R_SAVE} label="Save" active color="#3b5bdb" />
      <Button stableKey="btn-wipe" rect={R_WIPE} label="Wipe" active color="#a63d40" />
      <Button stableKey="btn-load" rect={R_LOAD} label="Load" active color="#2b8a7e" />
      <text x={80} y={520} width={640} height={50} text={store.msg} textSize="40" textColor="#ffd166" />
    </group>
  );
}

function bobOffset(animMs: number): number {
  return Math.floor(animMs / 1000) % 2 === 0 ? -6 : 6;
}

function BoardScreen() {
  const pr = () => MAPS[store.mapId].pathRow;
  const cells: { id: string; col: number; row: number }[] = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) cells.push({ id: `c${c}_${r}`, col: c, row: r });
  const ended = () => store.phase === 'lost' || store.phase === 'clear';
  const msgColor = () => (store.msg === 'Tower clear' ? '#7dffa0' : store.msg === 'Tower lost' ? '#ff7b7b' : '#ffd166');

  return (
    <group x={0} y={0} width={1280} height={720}>
      <text x={48} y={24} width={500} height={50} text="Tower Defense" textSize="40" textAlign="left" textColor="#ffe29a" />
      <text x={352} y={88} width={200} height={40} text={`wave ${currentWave(store)} / 3`} textSize="30" textColor="#ffffff" />
      <text x={580} y={88} width={160} height={40} text={`dp ${dpOf(store)}`} textSize="30" textColor="#9fd8ff" />
      <text x={760} y={88} width={180} height={40} text={`base ${store.base}`} textSize="30" textColor="#ffb4a2" />
      <text x={1020} y={88} width={220} height={40} text={MAPS[store.mapId].name} textSize="28" textColor="#cfd6e6" />

      <For each={cells}>
        {(c) => (
          <Show
            when={c.row === pr()}
            fallback={
              <Show
                when={isDeploy(store.mapId, c.col, c.row)}
                fallback={
                  <node
                    key={c.id}
                    x={cellX(c.col)}
                    y={cellY(c.row)}
                    width={CELL}
                    height={CELL}
                    backgroundColor="#171b26"
                    border="line"
                    borderWidth={1}
                    borderColor="#222838"
                  />
                }
              >
                <image
                  key={c.id}
                  source={grassTile}
                  x={cellX(c.col)}
                  y={cellY(c.row)}
                  width={CELL}
                  height={CELL}
                  imageFit="cover"
                  imageRenderSmoothing="off"
                />
              </Show>
            }
          >
            <image
              key={c.id}
              source={pathTile}
              x={cellX(c.col)}
              y={cellY(c.row)}
              width={CELL}
              height={CELL}
              imageFit="cover"
              imageRenderSmoothing="off"
            />
          </Show>
        )}
      </For>
      <image
        key="base-tile"
        source={baseTile}
        x={cellX(COLS)}
        y={cellY(pr())}
        width={CELL}
        height={CELL}
        imageFit="cover"
        imageRenderSmoothing="off"
      />
      <text x={cellX(COLS)} y={cellY(pr()) + CELL + 4} width={CELL} height={22} text="base" textSize="16" textAlign="center" textColor="#ffb4a2" />

      <For each={store.defs}>
        {(df) => (
          <group key={df.id} x={cellX(df.col)} y={cellY(df.row)} width={CELL} height={CELL}>
            <image source={IMG[df.kind]} x={8} y={2} width={56} height={56} imageFit="contain" imageRenderSmoothing="off" />
            <text x={0} y={52} width={CELL} height={20} text={df.up ? `${df.kind}+` : df.kind} textSize="15" textAlign="center" textColor="#ffffff" />
            <Show when={df.kind === 'wall'}>
              <text x={2} y={0} width={34} height={20} text={`${df.hp}`} textSize="16" textColor="#ffe29a" />
            </Show>
            <Show when={store.selected === df.id}>
              <node x={0} y={0} width={CELL} height={CELL} border="line" borderWidth={4} borderColor="#ffe14d" />
            </Show>
          </group>
        )}
      </For>

      <For each={store.enemies}>
        {(e) => (
          <group
            key={e.id}
            x={cellX(e.col)}
            y={cellY(pr()) + bobOffset(store.animMs) + (e.fly ? -16 : 0)}
            width={CELL}
            height={CELL}
          >
            <image source={IMG[e.name]} x={10} y={8} width={52} height={52} imageFit="contain" imageRenderSmoothing="off" />
            <text x={0} y={-6} width={CELL} height={20} text={`${e.name} ${e.hp}`} textSize="14" textAlign="center" textColor="#ff9d9d" />
          </group>
        )}
      </For>

      <For each={store.shots}>
        {(s) => (
          <group key={s.id} x={0} y={0} width={1280} height={720}>
            <line from={{ x: s.x1, y: s.y1 }} to={{ x: s.x2, y: s.y2 }} stroke={{ width: 4, color: '#fff27a' }} />
            <node
              x={s.x1 + (s.x2 - s.x1) * (((store.animMs - store.shotAt) % 600) / 600) - 7}
              y={s.y1 + (s.y2 - s.y1) * (((store.animMs - store.shotAt) % 600) / 600) - 7}
              width={14}
              height={14}
              shape="circular"
              backgroundColor="#ffffff"
              border="line"
              borderWidth={2}
              borderColor="#ffb703"
            />
          </group>
        )}
      </For>

      <For each={CARDS}>
        {(c) => (
          <group key={`card-${c.kind}`} x={c.rect.x} y={c.rect.y} width={c.rect.w} height={c.rect.h}>
            <node
              x={0}
              y={0}
              width={c.rect.w}
              height={c.rect.h}
              shape="roundedRect(8 8 8 8)"
              backgroundColor={store.phase === 'playing' && dpOf(store) >= c.cost ? '#34415f' : '#272c3a'}
              border="line"
              borderWidth={store.dragCard === c.kind ? 3 : 1}
              borderColor={store.dragCard === c.kind ? '#ffe14d' : '#4b5675'}
            />
            <image source={IMG[c.kind]} x={8} y={8} width={40} height={40} imageFit="contain" imageRenderSmoothing="off" />
            <text x={58} y={4} width={100} height={28} text={c.kind} textSize="22" textColor="#ffffff" />
            <text x={58} y={31} width={190} height={22} text={c.info} textSize="15" textColor="#aab3cc" />
            <text x={168} y={4} width={84} height={28} text={`cost ${c.cost}`} textSize="18" textAlign="right" textColor="#9fd8ff" />
          </group>
        )}
      </For>

      <Button stableKey="btn-upgrade" rect={R_UPGRADE} label="Upgrade 2" active={!ended()} color="#7c4dff" />
      <text x={1020} y={224} width={220} height={60} text="pick a defense first" textSize="15" textColor="#8b91a0" />
      <Button stableKey="btn-maps" rect={R_MAPS} label="Maps" active={ended()} color="#3b5bdb" />
      <Button stableKey="btn-step" rect={R_STEP} label="Step" active={store.phase === 'playing'} color="#2b8a3e" />
      <Button stableKey="btn-start" rect={R_START} label="Start" active={store.phase === 'ready'} color="#e8590c" />
      <Button stableKey="btn-retry" rect={R_RETRY} label="Retry" active={ended()} color="#c2255c" />

      <text x={352} y={540} width={576} height={60} text={store.msg} textSize="44" textAlign="center" textColor={msgColor()} />

      <image
        key="drag-ghost"
        hidden={store.dragCard === ''}
        source={IMG[store.dragCard === '' ? 'gun' : store.dragCard]}
        x={store.dragX - 28}
        y={store.dragY - 28}
        width={56}
        height={56}
        imageFit="contain"
        imageRenderSmoothing="off"
      />
    </group>
  );
}

function App() {
  useFrame((frame) => {
    const dt = frame.deltaSeconds;
    if (dt <= 0) return;
    commitChange('frame', (d: GameState) => tick(d, dt * 1000));
  });

  return (
    <scene
      name="main"
      width={1280}
      height={720}
      backgroundColor="#0f1220"
      onKeyDown={(event) => {
        const code = event.detail?.code;
        if (code === 'Enter' || code === 'Space') {
          commitChange('key', (d: GameState) => keyInput(d, code));
        }
      }}
    >
      <Show when={store.screen === 'select'} fallback={<BoardScreen />}>
        <SelectScreen />
      </Show>
      <node
        x={0}
        y={0}
        width={1280}
        height={720}
        clickable
        onPointerDown={(e) => commitChange('pointer down', (d: GameState) => pointerDown(d, e.x, e.y))}
        onPointerMove={(e) => {
          if (store.dragCard === '') return;
          commitChange('pointer move', (d: GameState) => pointerMove(d, e.x, e.y));
        }}
        onPointerUp={(e) => commitChange('pointer up', (d: GameState) => pointerUp(d, e.x, e.y))}
        onPointerCancel={() => {
          commitChange('pointer cancel', (d: GameState) => {
            d.dragCard = '';
          });
        }}
      />
    </scene>
  );
}

renderGame(() => <App />, { bindStore });
