#!/usr/bin/env python3
"""Emit the three headline games. python3 eval/pipeline/scripts/emit_three.py"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TASKS = ROOT / "tasks"
ORACLES = ROOT / "examples" / "oracles"

CONSTRAINT = """
## 实现约束

- 画面逻辑尺寸 1280×720。
- 可点控件必须覆盖下列矩形（左上角 x,y 与宽高）；按钮文案必须与 labels 完全一致。
- 状态字段名与类型必须与题面一致。
- 禁止随机；禁止用物理决定对错。
- 不要实现评测探测接口；不要读取 playplan 或 checkpoint 文件。
""".strip()

PROJECT = """config_version=5

[application]
config/name="{name}"
run/main_scene="res://game.tscn"
config/features=PackedStringArray("4.4")

[display]
window/size/viewport_width=1280
window/size/viewport_height=720
window/stretch/mode="disabled"

[rendering]
renderer/rendering_method="gl_compatibility"
"""

TSCN = """[gd_scene load_steps=2 format=3 uid="uid://eval{short}"]

[ext_resource type="Script" path="res://game.gd" id="1_game"]

[node name="Game" type="Node2D"]
script = ExtResource("1_game")
"""


def dump_schema(schema_id: str, fields: dict) -> dict:
    props = {
        "eval.schema_id": {"const": schema_id},
        "eval.schema_sha256": {"type": "string", "pattern": "^[a-f0-9]{64}$"},
    }
    required = ["eval.schema_id", "eval.schema_sha256"]
    for k, spec in fields.items():
        props[k] = spec
        required.append(k)
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": schema_id,
        "type": "object",
        "additionalProperties": False,
        "required": required,
        "properties": props,
    }


def write(path: Path, text: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    if not text.endswith("\n"):
        text += "\n"
    path.write_text(text)


def write_json(path: Path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2, ensure_ascii=False) + "\n")


def region_block(geom: dict) -> str:
    lines = []
    for name, r in geom["regions"].items():
        label = (geom.get("labels") or {}).get(name, "")
        extra = f' 文案 "{label}"' if label else ""
        lines.append(f"- `{name}`: x={r['x']}, y={r['y']}, w={r['w']}, h={r['h']}{extra}")
    return "\n".join(lines)


def emit_task(task: dict):
    tid = task["id"]
    d = TASKS / tid
    schema_id = f"eval.{tid}/1"
    schema = dump_schema(schema_id, task["fields"])
    constraint = task.get("constraint", CONSTRAINT)
    instr = task["instruction"].strip() + "\n\n" + region_block(task["geom"]) + "\n\n" + constraint + "\n"
    for w in ["ColorRect", "Autoload", "bindStore", "CharacterBody2D", "<node>", "For"]:
        if w in instr:
            raise SystemExit(f"banned word {w} in {tid}")
    write(d / "instruction.md", instr)
    write(
        d / "task.yaml",
        f"""id: {tid}
tier: P1
engines: [onegame, godot]
entry: src/game.tsx
scene: {{ count: 1, width: 1280, height: 720 }}
schema: dump.schema.json
judge: schema_strict
rng: forbidden
physics: forbidden
""",
    )
    geom = task["geom"]
    labels = geom.get("labels") or {}
    lines = ["regions:"]
    for n, r in geom["regions"].items():
        lines.append(f"  {n}: {{ x: {r['x']}, y: {r['y']}, w: {r['w']}, h: {r['h']} }}")
    lines.append("labels:")
    if labels:
        for n, lab in labels.items():
            lines.append(f"  {n}: {lab}")
    else:
        lines[-1] = "labels: {}"
    lines.append("frozen_click_centers: []")
    write(d / "geometry.yaml", "\n".join(lines) + "\n")
    write_json(d / "dump.schema.json", schema)
    write_json(
        d / "playplan.json",
        {"schema": "eval.playplan/1", "closed_set": True, "post_ticks_after_input": 1, "steps": task["pos_steps"]},
    )
    write_json(
        d / "playplan.neg.json",
        {"schema": "eval.playplan/1", "closed_set": True, "post_ticks_after_input": 1, "steps": task["neg_steps"]},
    )
    write_json(
        d / "checkpoint.json",
        {
            "schema": "eval.checkpoint/1",
            "select": "dump",
            "compare": {"mode": "schema_strict", "extras": "fail", **task.get("compare_extra", {})},
            "slices": task["checks"],
        },
    )
    write(ORACLES / tid / "onegame" / "src" / "game.tsx", task["tsx"])
    write(ORACLES / tid / "godot" / "game.gd", task["gd"])
    write(ORACLES / tid / "godot" / "game.tscn", TSCN.format(short=tid.replace("-", "")))
    write(ORACLES / tid / "godot" / "project.godot", PROJECT.format(name=tid))
    print("emitted", tid)


BTN = '''import { createSignal } from 'solid-js';
import {
  createGameStore,
  renderGame,
  useNodeActive,
  useNodeHover,
  type VirtualNode,
} from '@1game/engine-bundle/runtime/worker';
'''

BTN_FRAME = '''import { createSignal } from 'solid-js';
import {
  createGameStore,
  renderGame,
  useNodeActive,
  useNodeHover,
  useFrame,
  type VirtualNode,
} from '@1game/engine-bundle/runtime/worker';
'''

RAIL_TSX = BTN + r'''
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
'''

RAIL_GD = r'''extends Node2D
var power: bool = false
var track: int = 0
var armed: Array = [false, false, false]
var shots: Array = [0, 0, 0]
var _hud: Label
var _btns: Dictionary = {}

func _ready() -> void:
	var bg := ColorRect.new()
	bg.position = Vector2.ZERO
	bg.size = Vector2(1280, 720)
	bg.color = Color("0f1224")
	bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(bg)
	_hud = Label.new()
	_hud.position = Vector2(40, 20)
	_hud.size = Vector2(1200, 72)
	_hud.add_theme_font_size_override("font_size", 32)
	add_child(_hud)
	_add_btn("power", 80, 120, 240, 100, "Power")
	_add_btn("t0", 360, 120, 160, 100, "0")
	_add_btn("t1", 560, 120, 160, 100, "1")
	_add_btn("t2", 760, 120, 160, 100, "2")
	_add_btn("arm", 200, 400, 360, 140, "Arm")
	_add_btn("fire", 720, 400, 360, 140, "Fire")
	_refresh()

func _add_btn(id: String, x: int, y: int, w: int, h: int, caption: String) -> void:
	var r := ColorRect.new()
	r.position = Vector2(x, y)
	r.size = Vector2(w, h)
	r.color = Color("2563eb")
	r.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(r)
	_btns[id] = r
	var lab := Label.new()
	lab.position = Vector2(x, y + maxi(0, int(h / 2) - 28))
	lab.size = Vector2(w, mini(h, 80))
	lab.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	lab.text = caption
	lab.add_theme_font_size_override("font_size", 40)
	add_child(lab)

func _paint(id: String, on: bool) -> void:
	if _btns.has(id):
		_btns[id].color = Color("fbbf24") if on else Color("2563eb")

func _refresh() -> void:
	_hud.text = "power=%s track=%s armed=%s%s%s shots=%s%s%s" % [power, track, int(armed[0]), int(armed[1]), int(armed[2]), shots[0], shots[1], shots[2]]
	_paint("power", power)
	_paint("t0", track == 0)
	_paint("t1", track == 1)
	_paint("t2", track == 2)
	_paint("arm", armed[track])

func _input(event) -> void:
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		var p = event.position
		if p.x >= 80 and p.x < 320 and p.y >= 120 and p.y < 220:
			power = not power
		elif p.x >= 360 and p.x < 520 and p.y >= 120 and p.y < 220:
			track = 0
		elif p.x >= 560 and p.x < 720 and p.y >= 120 and p.y < 220:
			track = 1
		elif p.x >= 760 and p.x < 920 and p.y >= 120 and p.y < 220:
			track = 2
		elif p.x >= 200 and p.x < 560 and p.y >= 400 and p.y < 540:
			if power:
				armed = [false, false, false]
				armed[track] = true
		elif p.x >= 720 and p.x < 1080 and p.y >= 400 and p.y < 540:
			if power and armed[track]:
				shots[track] += 1
				armed[track] = false
		_refresh()
'''

STOCK_TSX = r'''import {
  createGameStore,
  renderGame,
} from '@1game/engine-bundle/runtime/worker';

type GameState = {
  px: number;
  py: number;
  b0x: number;
  b0y: number;
  b1x: number;
  b1y: number;
  cleared: boolean;
};

const { store, commitChange, bindStore } = createGameStore({
  px: 0,
  py: 0,
  b0x: 1,
  b0y: 0,
  b1x: 1,
  b1y: 1,
  cleared: false,
} satisfies GameState);

function inBound(x: number, y: number) {
  return x >= 0 && x <= 2 && y >= 0 && y <= 1;
}

function boxAt(d: GameState, x: number, y: number) {
  return (d.b0x === x && d.b0y === y) || (d.b1x === x && d.b1y === y);
}

function onGoals(d: GameState) {
  const a = `${d.b0x},${d.b0y}`;
  const b = `${d.b1x},${d.b1y}`;
  return (a === '2,0' || a === '2,1') && (b === '2,0' || b === '2,1') && a !== b;
}

function nudge(code: string) {
  commitChange('nudge', (d: GameState) => {
    let dx = 0;
    let dy = 0;
    if (code === 'ArrowRight') dx = 1;
    if (code === 'ArrowLeft') dx = -1;
    if (code === 'ArrowUp') dy = 1;
    if (code === 'ArrowDown') dy = -1;
    if (dx === 0 && dy === 0) return;
    const nx = d.px + dx;
    const ny = d.py + dy;
    if (!inBound(nx, ny)) return;
    if (boxAt(d, nx, ny)) {
      const bx = nx + dx;
      const by = ny + dy;
      if (!inBound(bx, by) || boxAt(d, bx, by)) return;
      if (d.b0x === nx && d.b0y === ny) {
        d.b0x = bx;
        d.b0y = by;
      } else {
        d.b1x = bx;
        d.b1y = by;
      }
    }
    d.px = nx;
    d.py = ny;
    d.cleared = onGoals(d);
  });
}

function cellColor(x: number, y: number) {
  const goal = x === 2;
  const box = (store.b0x === x && store.b0y === y) || (store.b1x === x && store.b1y === y);
  const player = store.px === x && store.py === y;
  if (box && goal) return '#f59e0b';
  if (box) return '#ea580c';
  if (player) return '#1d4ed8';
  if (goal) return '#14532d';
  return '#1f2937';
}

function App() {
  return (
    <scene name="main" width={1280} height={720} backgroundColor="#0f1224" onKeyDown={(e) => nudge(e.detail?.code)}>
      <text x={40} y={16} width={1200} height={64} text={`p=${store.px},${store.py} b0=${store.b0x},${store.b0y} b1=${store.b1x},${store.b1y} cleared=${store.cleared}`} textColor="#fff" textSize={28} />
      <node x={140} y={400} width={280} height={200} shape="roundedRect(16 16 16 16)" backgroundColor={cellColor(0, 0)} />
      <node x={500} y={400} width={280} height={200} shape="roundedRect(16 16 16 16)" backgroundColor={cellColor(1, 0)} />
      <node x={860} y={400} width={280} height={200} shape="roundedRect(16 16 16 16)" backgroundColor={cellColor(2, 0)} />
      <node x={140} y={160} width={280} height={200} shape="roundedRect(16 16 16 16)" backgroundColor={cellColor(0, 1)} />
      <node x={500} y={160} width={280} height={200} shape="roundedRect(16 16 16 16)" backgroundColor={cellColor(1, 1)} />
      <node x={860} y={160} width={280} height={200} shape="roundedRect(16 16 16 16)" backgroundColor={cellColor(2, 1)} />
    </scene>
  );
}
renderGame(() => <App />, { bindStore });
'''

STOCK_GD = r'''extends Node2D
var px: int = 0
var py: int = 0
var b0x: int = 1
var b0y: int = 0
var b1x: int = 1
var b1y: int = 1
var cleared: bool = false
var _hud: Label
var _cells: Array = []

func _ready() -> void:
	var bg := ColorRect.new()
	bg.position = Vector2.ZERO
	bg.size = Vector2(1280, 720)
	bg.color = Color("0f1224")
	bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(bg)
	_hud = Label.new()
	_hud.position = Vector2(40, 16)
	_hud.size = Vector2(1200, 64)
	_hud.add_theme_font_size_override("font_size", 28)
	add_child(_hud)
	for y in 2:
		for x in 3:
			var cell := ColorRect.new()
			cell.position = Vector2(140 + x * 360, 400 - y * 240)
			cell.size = Vector2(280, 200)
			cell.mouse_filter = Control.MOUSE_FILTER_IGNORE
			add_child(cell)
			_cells.append(cell)
	_refresh()

func _in(x: int, y: int) -> bool:
	return x >= 0 and x <= 2 and y >= 0 and y <= 1

func _box(x: int, y: int) -> bool:
	return (b0x == x and b0y == y) or (b1x == x and b1y == y)

func _goals() -> bool:
	var a := "%s,%s" % [b0x, b0y]
	var b := "%s,%s" % [b1x, b1y]
	return (a == "2,0" or a == "2,1") and (b == "2,0" or b == "2,1") and a != b

func _try(dx: int, dy: int) -> void:
	var nx := px + dx
	var ny := py + dy
	if not _in(nx, ny):
		return
	if _box(nx, ny):
		var bx := nx + dx
		var by := ny + dy
		if not _in(bx, by) or _box(bx, by):
			return
		if b0x == nx and b0y == ny:
			b0x = bx
			b0y = by
		else:
			b1x = bx
			b1y = by
	px = nx
	py = ny
	cleared = _goals()

func _color(x: int, y: int) -> Color:
	var goal := x == 2
	var box := _box(x, y)
	var player := px == x and py == y
	if box and goal:
		return Color("f59e0b")
	if box:
		return Color("ea580c")
	if player:
		return Color("1d4ed8")
	if goal:
		return Color("14532d")
	return Color("1f2937")

func _refresh() -> void:
	_hud.text = "p=%s,%s b0=%s,%s b1=%s,%s cleared=%s" % [px, py, b0x, b0y, b1x, b1y, cleared]
	var i := 0
	for y in 2:
		for x in 3:
			_cells[i].color = _color(x, y)
			i += 1

func _input(event) -> void:
	if event is InputEventKey and event.pressed and not event.echo:
		if event.keycode == KEY_RIGHT:
			_try(1, 0)
		elif event.keycode == KEY_LEFT:
			_try(-1, 0)
		elif event.keycode == KEY_UP:
			_try(0, 1)
		elif event.keycode == KEY_DOWN:
			_try(0, -1)
		_refresh()
'''

BEAT_TSX = BTN_FRAME + r'''
type GameState = {
  phase: 'ready' | 'countdown' | 'playing';
  remainMs: number;
  clockMs: number;
  hits: number;
  misses: number;
  score: number;
  resolved: [boolean, boolean, boolean];
};

const { store, commitChange, bindStore } = createGameStore({
  phase: 'ready',
  remainMs: 0,
  clockMs: 0,
  hits: 0,
  misses: 0,
  score: 0,
  resolved: [false, false, false] as [boolean, boolean, boolean],
} satisfies GameState);

function beatAt(clock: number) {
  if (clock >= 0 && clock < 480) return 0;
  if (clock >= 800 && clock < 1280) return 1;
  if (clock >= 1600 && clock < 2080) return 2;
  return -1;
}

function StartBtn() {
  const [node, setNode] = createSignal<VirtualNode | undefined>();
  const hover = useNodeHover(node);
  const active = useNodeActive(node);
  return (
    <group
      x={440}
      y={200}
      width={400}
      height={120}
      clickable
      virtualNodeRef={setNode}
      onClick={() => {
        commitChange('start', (d: GameState) => {
          if (d.phase !== 'ready') return;
          d.phase = 'countdown';
          d.remainMs = 3000;
        });
      }}
    >
      <node x={0} y={0} width={400} height={120} shape="roundedRect(28 28 28 28)" backgroundColor={active() ? '#1d4ed8' : hover() ? '#3b82f6' : '#2563eb'} />
      <text x={0} y={24} width={400} height={72} text="Start" textAlign="center" textSize={48} textColor="#ffffff" />
    </group>
  );
}

function App() {
  useFrame((frame) => {
    const dt = frame.deltaSeconds;
    if (dt <= 0) return;
    commitChange('tick', (d: GameState) => {
      const step = Math.round(dt * 1000);
      if (d.phase === 'countdown') {
        d.remainMs = Math.max(0, d.remainMs - step);
        if (d.remainMs <= 0) {
          d.remainMs = 0;
          d.phase = 'playing';
          d.clockMs = 0;
        }
      } else if (d.phase === 'playing') {
        d.clockMs += step;
      }
    });
  });
  const open = beatAt(store.clockMs);
  return (
    <scene
      name="main"
      width={1280}
      height={720}
      backgroundColor="#0f1224"
      onKeyDown={(e) => {
        if (e.detail?.code !== 'Space') return;
        commitChange('hit', (d: GameState) => {
          if (d.phase !== 'playing') return;
          const idx = beatAt(d.clockMs);
          if (idx >= 0 && !d.resolved[idx]) {
            const resolved: [boolean, boolean, boolean] = [d.resolved[0], d.resolved[1], d.resolved[2]];
            resolved[idx] = true;
            d.resolved = resolved;
            d.hits += 1;
            d.score += 1;
          } else {
            d.misses += 1;
          }
        });
      }}
    >
      <text x={40} y={16} width={1200} height={64} text={`phase=${store.phase} remainMs=${store.remainMs} clockMs=${store.clockMs} hits=${store.hits} misses=${store.misses} score=${store.score}`} textColor="#fff" textSize={26} />
      <node x={200} y={520} width={200} height={120} shape="roundedRect(16 16 16 16)" backgroundColor={open === 0 || store.resolved[0] ? '#fbbf24' : '#1f2937'} />
      <node x={540} y={520} width={200} height={120} shape="roundedRect(16 16 16 16)" backgroundColor={open === 1 || store.resolved[1] ? '#fbbf24' : '#1f2937'} />
      <node x={880} y={520} width={200} height={120} shape="roundedRect(16 16 16 16)" backgroundColor={open === 2 || store.resolved[2] ? '#fbbf24' : '#334155'} />
      <StartBtn />
    </scene>
  );
}
renderGame(() => <App />, { bindStore });
'''

BEAT_GD = r'''extends Node2D
var phase: String = "ready"
var remainMs: int = 0
var clockMs: int = 0
var hits: int = 0
var misses: int = 0
var score: int = 0
var resolved: Array = [false, false, false]
var _hud: Label
var _notes: Array = []
var _start: ColorRect

func _ready() -> void:
	var bg := ColorRect.new()
	bg.position = Vector2.ZERO
	bg.size = Vector2(1280, 720)
	bg.color = Color("0f1224")
	bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(bg)
	_hud = Label.new()
	_hud.position = Vector2(40, 16)
	_hud.size = Vector2(1200, 64)
	_hud.add_theme_font_size_override("font_size", 26)
	add_child(_hud)
	_start = ColorRect.new()
	_start.position = Vector2(440, 200)
	_start.size = Vector2(400, 120)
	_start.color = Color("2563eb")
	_start.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_start)
	var lab := Label.new()
	lab.position = Vector2(440, 224)
	lab.size = Vector2(400, 72)
	lab.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	lab.text = "Start"
	lab.add_theme_font_size_override("font_size", 48)
	add_child(lab)
	for i in 3:
		var n := ColorRect.new()
		n.position = Vector2(200 + i * 340, 520)
		n.size = Vector2(200, 120)
		n.mouse_filter = Control.MOUSE_FILTER_IGNORE
		add_child(n)
		_notes.append(n)
	_refresh()

func _beat(clock: int) -> int:
	if clock >= 0 and clock < 480:
		return 0
	if clock >= 800 and clock < 1280:
		return 1
	if clock >= 1600 and clock < 2080:
		return 2
	return -1

func _process(dt: float) -> void:
	var step := int(round(dt * 1000.0))
	if step <= 0:
		return
	if phase == "countdown":
		remainMs = maxi(0, remainMs - step)
		if remainMs <= 0:
			remainMs = 0
			phase = "playing"
			clockMs = 0
	elif phase == "playing":
		clockMs += step
	_refresh()

func _refresh() -> void:
	_hud.text = "phase=%s remainMs=%s clockMs=%s hits=%s misses=%s score=%s" % [phase, remainMs, clockMs, hits, misses, score]
	var open := _beat(clockMs)
	for i in 3:
		var on: bool = (open == i) or bool(resolved[i])
		if i == 2:
			_notes[i].color = Color("fbbf24") if on else Color("334155")
		else:
			_notes[i].color = Color("fbbf24") if on else Color("1f2937")

func _input(event) -> void:
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		var p = event.position
		if p.x >= 440 and p.x < 840 and p.y >= 200 and p.y < 320:
			if phase == "ready":
				phase = "countdown"
				remainMs = 3000
		_refresh()
	if event is InputEventKey and event.pressed and not event.echo and event.keycode == KEY_SPACE:
		if phase == "playing":
			var idx := _beat(clockMs)
			if idx >= 0 and not resolved[idx]:
				resolved[idx] = true
				hits += 1
				score += 1
			else:
				misses += 1
			_refresh()
'''


def main():
    emit_task(
        {
            "id": "p1-rail-desk",
            "fields": {
                "power": {"type": "boolean"},
                "track": {"type": "integer", "minimum": 0, "maximum": 2},
                "armed": {"type": "array", "minItems": 3, "maxItems": 3, "items": {"type": "boolean"}},
                "shots": {"type": "array", "minItems": 3, "maxItems": 3, "items": {"type": "integer", "minimum": 0}},
            },
            "instruction": """标题：调度台

做一个 1280×720 的控制室微游戏。三条轨道要先通电，再选轨、上膛、按序发射。

玩家体验：
- Power 按钮文案必须是 Power。点它切换 power。未通电时 Arm 与 Fire 都不得改 armed 或 shots。
- 三个选轨按钮文案必须是 0、1、2。点中后 track 变成对应整数。未通电也可以换轨。同一时刻只有当前轨按钮外观不同。
- Arm：仅当 power 为真时，把当前轨 armed 设为真，并把另外两轨 armed 设为假。未通电点 Arm 什么也不变。
- Fire：仅当 power 为真且当前轨 armed 为真时，该轨 shots 加 1，该轨 armed 变假。否则什么也不变。
- 点 dead 不得改状态。
- 顶部状态条必须能读出 power、track、三轨 armed、三轨 shots。

状态字段：
- power: 布尔，初始 false
- track: 整数 0..2，初始 0
- armed: 三个布尔的数组，初始全 false
- shots: 三个整数的数组，初始全 0
""",
            "geom": {
                "regions": {
                    "power": {"x": 80, "y": 120, "w": 240, "h": 100},
                    "t0": {"x": 360, "y": 120, "w": 160, "h": 100},
                    "t1": {"x": 560, "y": 120, "w": 160, "h": 100},
                    "t2": {"x": 760, "y": 120, "w": 160, "h": 100},
                    "arm": {"x": 200, "y": 400, "w": 360, "h": 140},
                    "fire": {"x": 720, "y": 400, "w": 360, "h": 140},
                    "dead": {"x": 0, "y": 600, "w": 160, "h": 100},
                },
                "labels": {"power": "Power", "t0": "0", "t1": "1", "t2": "2", "arm": "Arm", "fire": "Fire"},
            },
            "pos_steps": [
                {"id": "cp0", "checkpoint": "init"},
                {"id": "pw", "click": "power"},
                {"id": "c_pw", "checkpoint": "after_power"},
                {"id": "t1", "click": "t1"},
                {"id": "c_t1", "checkpoint": "after_t1"},
                {"id": "a1", "click": "arm"},
                {"id": "c_a1", "checkpoint": "after_arm1"},
                {"id": "f1", "click": "fire"},
                {"id": "c_f1", "checkpoint": "fired1"},
                {"id": "t2", "click": "t2"},
                {"id": "c_t2", "checkpoint": "after_t2"},
                {"id": "a2", "click": "arm"},
                {"id": "c_a2", "checkpoint": "after_arm2"},
                {"id": "f2", "click": "fire"},
                {"id": "c_f2", "checkpoint": "fired2"},
                {"id": "t0", "click": "t0"},
                {"id": "c_t0", "checkpoint": "after_t0"},
                {"id": "a0", "click": "arm"},
                {"id": "c_a0", "checkpoint": "after_arm0"},
                {"id": "f0", "click": "fire"},
                {"id": "c_f0", "checkpoint": "fired0"},
            ],
            "neg_steps": [
                {"id": "cp0", "checkpoint": "init"},
                {"id": "dead", "click": "dead"},
                {"id": "f0", "click": "fire"},
                {"id": "a0", "click": "arm"},
                {"id": "t2", "click": "t2"},
                {"id": "f1", "click": "fire"},
                {"id": "cp1", "checkpoint": "neg_final"},
            ],
            "checks": {
                "init": {"power": False, "track": 0, "armed": [False, False, False], "shots": [0, 0, 0]},
                "after_power": {"power": True, "track": 0, "armed": [False, False, False], "shots": [0, 0, 0]},
                "after_t1": {"power": True, "track": 1, "armed": [False, False, False], "shots": [0, 0, 0]},
                "after_arm1": {"power": True, "track": 1, "armed": [False, True, False], "shots": [0, 0, 0]},
                "fired1": {"power": True, "track": 1, "armed": [False, False, False], "shots": [0, 1, 0]},
                "after_t2": {"power": True, "track": 2, "armed": [False, False, False], "shots": [0, 1, 0]},
                "after_arm2": {"power": True, "track": 2, "armed": [False, False, True], "shots": [0, 1, 0]},
                "fired2": {"power": True, "track": 2, "armed": [False, False, False], "shots": [0, 1, 1]},
                "after_t0": {"power": True, "track": 0, "armed": [False, False, False], "shots": [0, 1, 1]},
                "after_arm0": {"power": True, "track": 0, "armed": [True, False, False], "shots": [0, 1, 1]},
                "fired0": {"power": True, "track": 0, "armed": [False, False, False], "shots": [1, 1, 1]},
                "neg_final": {"power": False, "track": 2, "armed": [False, False, False], "shots": [0, 0, 0]},
            },
            "tsx": RAIL_TSX,
            "gd": RAIL_GD,
        }
    )
    emit_task(
        {
            "id": "p1-stock-push",
            "fields": {
                "px": {"type": "integer", "minimum": 0, "maximum": 2},
                "py": {"type": "integer", "minimum": 0, "maximum": 1},
                "b0x": {"type": "integer", "minimum": 0, "maximum": 2},
                "b0y": {"type": "integer", "minimum": 0, "maximum": 1},
                "b1x": {"type": "integer", "minimum": 0, "maximum": 2},
                "b1y": {"type": "integer", "minimum": 0, "maximum": 1},
                "cleared": {"type": "boolean"},
            },
            "instruction": """标题：库房推移

做一个 1280×720 的空间微游戏。不要处理指针点击。玩家在 3×2 格子上推两只箱子进目标格。

玩家体验：
- 格子坐标 x 为 0..2，y 为 0..1。越出该范围的移动必须夹紧（状态不变）。
- 玩家初始在 (0,0)。箱子 0 初始在 (1,0)，箱子 1 初始在 (1,1)。目标格是 (2,0) 与 (2,1)。
- ArrowRight / ArrowLeft / ArrowUp / ArrowDown 尝试把玩家沿轴移动一格。ArrowUp 增加 y，ArrowDown 减少 y。
- 若目标格有箱子，且箱子朝同一方向的下一格在界内且没有另一只箱子，则箱子被推过去，玩家走进箱子原格。否则整步不变。
- 当两只箱子分别占据两格目标时 cleared 为真，否则为假。
- 玩家、箱子、空目标格、普通空格外观必须两两能分开。
- 顶部状态条必须能读出玩家坐标、两只箱子坐标、cleared。

状态字段：
- px, py: 玩家坐标整数
- b0x, b0y, b1x, b1y: 两只箱子坐标整数
- cleared: 布尔，初始 false
""",
            "constraint": """## 实现约束

- 画面逻辑尺寸 1280×720。
- 六格必须覆盖下列矩形（左上角 x,y 与宽高）。y=0 是下面一排，y=1 是上面一排。
- 状态字段名与类型必须与题面一致。
- 禁止随机；禁止用物理决定对错。
- 不要实现评测探测接口；不要读取 playplan 或 checkpoint 文件。
""".strip(),
            "geom": {
                "regions": {
                    "cell_0_0": {"x": 140, "y": 400, "w": 280, "h": 200},
                    "cell_1_0": {"x": 500, "y": 400, "w": 280, "h": 200},
                    "cell_2_0": {"x": 860, "y": 400, "w": 280, "h": 200},
                    "cell_0_1": {"x": 140, "y": 160, "w": 280, "h": 200},
                    "cell_1_1": {"x": 500, "y": 160, "w": 280, "h": 200},
                    "cell_2_1": {"x": 860, "y": 160, "w": 280, "h": 200},
                    "goal0": {"x": 860, "y": 400, "w": 280, "h": 200},
                    "goal1": {"x": 860, "y": 160, "w": 280, "h": 200},
                    "dead": {"x": 0, "y": 0, "w": 100, "h": 80},
                },
                "labels": {},
            },
            "pos_steps": [
                {"id": "cp0", "checkpoint": "init"},
                {"id": "kl", "keydown": "ArrowLeft"},
                {"id": "ul", "keyup": "ArrowLeft"},
                {"id": "c_bl", "checkpoint": "blocked_left"},
                {"id": "kr", "keydown": "ArrowRight"},
                {"id": "ur", "keyup": "ArrowRight"},
                {"id": "c_b0", "checkpoint": "box0_goal"},
                {"id": "kd", "keydown": "ArrowDown"},
                {"id": "ud", "keyup": "ArrowDown"},
                {"id": "c_bd", "checkpoint": "blocked_down"},
                {"id": "kl2", "keydown": "ArrowLeft"},
                {"id": "ul2", "keyup": "ArrowLeft"},
                {"id": "c_back", "checkpoint": "after_back"},
                {"id": "ku", "keydown": "ArrowUp"},
                {"id": "uu", "keyup": "ArrowUp"},
                {"id": "c_up", "checkpoint": "after_up"},
                {"id": "ku2", "keydown": "ArrowUp"},
                {"id": "uu2", "keyup": "ArrowUp"},
                {"id": "c_bu", "checkpoint": "blocked_up"},
                {"id": "kr2", "keydown": "ArrowRight"},
                {"id": "ur2", "keyup": "ArrowRight"},
                {"id": "c_b1", "checkpoint": "box1_goal"},
            ],
            "neg_steps": [
                {"id": "cp0", "checkpoint": "init"},
                {"id": "dead", "click": "dead"},
                {"id": "kl", "keydown": "ArrowLeft"},
                {"id": "ul", "keyup": "ArrowLeft"},
                {"id": "kd", "keydown": "ArrowDown"},
                {"id": "ud", "keyup": "ArrowDown"},
                {"id": "kl2", "keydown": "ArrowLeft"},
                {"id": "ul2", "keyup": "ArrowLeft"},
                {"id": "cp1", "checkpoint": "neg_final"},
            ],
            "checks": {
                "init": {"px": 0, "py": 0, "b0x": 1, "b0y": 0, "b1x": 1, "b1y": 1, "cleared": False},
                "blocked_left": {"px": 0, "py": 0, "b0x": 1, "b0y": 0, "b1x": 1, "b1y": 1, "cleared": False},
                "box0_goal": {"px": 1, "py": 0, "b0x": 2, "b0y": 0, "b1x": 1, "b1y": 1, "cleared": False},
                "blocked_down": {"px": 1, "py": 0, "b0x": 2, "b0y": 0, "b1x": 1, "b1y": 1, "cleared": False},
                "after_back": {"px": 0, "py": 0, "b0x": 2, "b0y": 0, "b1x": 1, "b1y": 1, "cleared": False},
                "after_up": {"px": 0, "py": 1, "b0x": 2, "b0y": 0, "b1x": 1, "b1y": 1, "cleared": False},
                "blocked_up": {"px": 0, "py": 1, "b0x": 2, "b0y": 0, "b1x": 1, "b1y": 1, "cleared": False},
                "box1_goal": {"px": 1, "py": 1, "b0x": 2, "b0y": 0, "b1x": 2, "b1y": 1, "cleared": True},
                "neg_final": {"px": 0, "py": 0, "b0x": 1, "b0y": 0, "b1x": 1, "b1y": 1, "cleared": False},
            },
            "tsx": STOCK_TSX,
            "gd": STOCK_GD,
        }
    )
    emit_task(
        {
            "id": "p1-beat-window",
            "fields": {
                "phase": {"enum": ["ready", "countdown", "playing"]},
                "remainMs": {"type": "integer", "minimum": 0},
                "clockMs": {"type": "integer", "minimum": 0},
                "hits": {"type": "integer", "minimum": 0},
                "misses": {"type": "integer", "minimum": 0},
                "score": {"type": "integer", "minimum": 0},
                "resolved": {"type": "array", "minItems": 3, "maxItems": 3, "items": {"type": "boolean"}},
            },
            "compare_extra": {"remainMs_lte": 0},
            "instruction": """标题：节拍窗

做一个 1280×720 的节奏微游戏。先按 Start 倒计时，再在三个时间窗内用空格击中音符。

玩家体验：
- 开局 phase 为 ready。Start 按钮文案必须是 Start。点中后 phase 变成 countdown，remainMs 变成 3000。
- countdown 期间每帧减少 remainMs；到 0 时 phase 变成 playing，clockMs 从 0 开始累加。
- playing 时三个窗口（单位毫秒）：[0,480)、[800,1280)、[1600,2080)。窗口内且该音尚未 resolved 时按 Space：hits 加 1，score 加 1，对应 resolved 变真。否则 misses 加 1，score 不变。
- ready 或 countdown 时按 Space、点 dead，都不得改 hits/misses/score。ready 时走时钟不得自行进入 countdown。
- 三个音符格外观：当前窗口或已击中的必须与未击中且不在窗口的不同。第二与第三格底色也要能分开。
- 顶部状态条必须能读出 phase、remainMs、clockMs、hits、misses、score。

状态字段：
- phase: 只能是 ready、countdown 或 playing，初始 ready
- remainMs: 整数，初始 0
- clockMs: 整数，初始 0
- hits, misses, score: 整数，初始 0
- resolved: 三个布尔，初始全 false
""",
            "geom": {
                "regions": {
                    "start": {"x": 440, "y": 200, "w": 400, "h": 120},
                    "note0": {"x": 200, "y": 520, "w": 200, "h": 120},
                    "note1": {"x": 540, "y": 520, "w": 200, "h": 120},
                    "note2": {"x": 880, "y": 520, "w": 200, "h": 120},
                    "dead": {"x": 0, "y": 0, "w": 160, "h": 80},
                },
                "labels": {"start": "Start"},
            },
            "pos_steps": [
                {"id": "cp0", "checkpoint": "init"},
                {"id": "st", "click": "start"},
                {"id": "c_st", "checkpoint": "after_start"},
                {"id": "wait", "tick": 188},
                {"id": "c_pl", "checkpoint": "after_play"},
                {"id": "w0", "tick": 8},
                {"id": "s0d", "keydown": "Space"},
                {"id": "s0u", "keyup": "Space"},
                {"id": "c_h0", "checkpoint": "hit0"},
                {"id": "wg", "tick": 30},
                {"id": "smd", "keydown": "Space"},
                {"id": "smu", "keyup": "Space"},
                {"id": "c_m", "checkpoint": "after_miss"},
                {"id": "w1", "tick": 20},
                {"id": "s1d", "keydown": "Space"},
                {"id": "s1u", "keyup": "Space"},
                {"id": "c_h1", "checkpoint": "hit1"},
                {"id": "w2", "tick": 45},
                {"id": "s2d", "keydown": "Space"},
                {"id": "s2u", "keyup": "Space"},
                {"id": "c_h2", "checkpoint": "hit2"},
            ],
            "neg_steps": [
                {"id": "cp0", "checkpoint": "init"},
                {"id": "dead", "click": "dead"},
                {"id": "idle", "tick": 20},
                {"id": "spd", "keydown": "Space"},
                {"id": "spu", "keyup": "Space"},
                {"id": "cp1", "checkpoint": "neg_final"},
            ],
            "checks": {
                "init": {
                    "phase": "ready",
                    "remainMs": 0,
                    "clockMs": 0,
                    "hits": 0,
                    "misses": 0,
                    "score": 0,
                    "resolved": [False, False, False],
                },
                "after_start": {"phase": "countdown", "hits": 0, "misses": 0, "score": 0, "resolved": [False, False, False]},
                "after_play": {
                    "phase": "playing",
                    "remainMs": 0,
                    "hits": 0,
                    "misses": 0,
                    "score": 0,
                    "resolved": [False, False, False],
                },
                "hit0": {"phase": "playing", "hits": 1, "misses": 0, "score": 1, "resolved": [True, False, False]},
                "after_miss": {"phase": "playing", "hits": 1, "misses": 1, "score": 1, "resolved": [True, False, False]},
                "hit1": {"phase": "playing", "hits": 2, "misses": 1, "score": 2, "resolved": [True, True, False]},
                "hit2": {"phase": "playing", "hits": 3, "misses": 1, "score": 3, "resolved": [True, True, True]},
                "neg_final": {
                    "phase": "ready",
                    "remainMs": 0,
                    "clockMs": 0,
                    "hits": 0,
                    "misses": 0,
                    "score": 0,
                    "resolved": [False, False, False],
                },
            },
            "tsx": BEAT_TSX,
            "gd": BEAT_GD,
        }
    )


if __name__ == "__main__":
    main()
