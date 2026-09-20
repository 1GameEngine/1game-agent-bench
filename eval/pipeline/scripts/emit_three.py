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

SIGNAL_TSX = BTN + r'''
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
    <group key={props.label} x={props.x} y={props.y} width={props.w} height={props.h} clickable virtualNodeRef={setNode} onClick={props.onPress}>
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
'''

SIGNAL_GD = r'''extends Node2D
var lamp: bool = false
var channel: String = "A"
var armed: bool = false
var shots: int = 0
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
	_hud.position = Vector2(48, 24)
	_hud.size = Vector2(1184, 80)
	_hud.add_theme_font_size_override("font_size", 40)
	add_child(_hud)
	_add_btn("toggle", 80, 140, 240, 120, "Toggle")
	_add_btn("chanA", 400, 140, 200, 120, "A")
	_add_btn("chanB", 640, 140, 200, 120, "B")
	_add_btn("chanC", 880, 140, 200, 120, "C")
	_add_btn("arm", 200, 400, 360, 160, "Arm")
	_add_btn("fire", 720, 400, 360, 160, "Fire")
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
	lab.position = Vector2(x, y + maxi(0, int(h / 2) - 40))
	lab.size = Vector2(w, mini(h, 96))
	lab.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	lab.text = caption
	lab.add_theme_font_size_override("font_size", 48)
	add_child(lab)

func _paint(id: String, on: bool) -> void:
	if _btns.has(id):
		_btns[id].color = Color("fbbf24") if on else Color("2563eb")

func _refresh() -> void:
	_hud.text = "lamp=%s ch=%s armed=%s shots=%s" % [lamp, channel, armed, shots]
	_paint("toggle", lamp)
	_paint("chanA", channel == "A")
	_paint("chanB", channel == "B")
	_paint("chanC", channel == "C")
	_paint("arm", armed)

func _input(event) -> void:
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		var p = event.position
		if p.x >= 80 and p.x < 320 and p.y >= 140 and p.y < 260:
			lamp = not lamp
		elif p.x >= 400 and p.x < 600 and p.y >= 140 and p.y < 260:
			channel = "A"
		elif p.x >= 640 and p.x < 840 and p.y >= 140 and p.y < 260:
			channel = "B"
		elif p.x >= 880 and p.x < 1080 and p.y >= 140 and p.y < 260:
			channel = "C"
		elif p.x >= 200 and p.x < 560 and p.y >= 400 and p.y < 560:
			armed = true
		elif p.x >= 720 and p.x < 1080 and p.y >= 400 and p.y < 560:
			if armed:
				shots += 1
				armed = false
		_refresh()
'''

GRID_TSX = r'''import {
  createGameStore,
  renderGame,
} from '@1game/engine-bundle/runtime/worker';

type GameState = {
  x: number;
  marked: [boolean, boolean, boolean];
};

const { store, commitChange, bindStore } = createGameStore({
  x: 1,
  marked: [false, false, false] as [boolean, boolean, boolean],
} satisfies GameState);

function nudge(code: string) {
  commitChange('nudge', (draft: GameState) => {
    if (code === 'ArrowRight') draft.x = Math.min(2, draft.x + 1);
    if (code === 'ArrowLeft') draft.x = Math.max(0, draft.x - 1);
    if (code === 'Space') {
      const next: [boolean, boolean, boolean] = [draft.marked[0], draft.marked[1], draft.marked[2]];
      next[draft.x] = true;
      draft.marked = next;
    }
  });
}

function cellColor(i: number) {
  if (store.x === i) return store.marked[i] ? '#f59e0b' : '#1d4ed8';
  return store.marked[i] ? '#22c55e' : '#1f2937';
}

function App() {
  return (
    <scene name="main" width={1280} height={720} backgroundColor="#0f1224" onKeyDown={(e) => nudge(e.detail?.code)}>
      <text x={48} y={24} width={1184} height={80} text={`x=${store.x} marks=${store.marked[0] ? 1 : 0}${store.marked[1] ? 1 : 0}${store.marked[2] ? 1 : 0}`} textColor="#fff" textSize={40} />
      <node x={80} y={200} width={320} height={320} shape="roundedRect(24 24 24 24)" backgroundColor={cellColor(0)} />
      <node x={480} y={200} width={320} height={320} shape="roundedRect(24 24 24 24)" backgroundColor={cellColor(1)} />
      <node x={880} y={200} width={320} height={320} shape="roundedRect(24 24 24 24)" backgroundColor={cellColor(2)} />
    </scene>
  );
}
renderGame(() => <App />, { bindStore });
'''

GRID_GD = r'''extends Node2D
var x: int = 1
var marked: Array = [false, false, false]
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
	_hud.position = Vector2(48, 24)
	_hud.size = Vector2(1184, 80)
	_hud.add_theme_font_size_override("font_size", 40)
	add_child(_hud)
	for i in 3:
		var cell := ColorRect.new()
		cell.position = Vector2(80 + i * 400, 200)
		cell.size = Vector2(320, 320)
		cell.mouse_filter = Control.MOUSE_FILTER_IGNORE
		add_child(cell)
		_cells.append(cell)
	_refresh()

func _refresh() -> void:
	_hud.text = "x=%s marks=%s%s%s" % [x, int(marked[0]), int(marked[1]), int(marked[2])]
	for i in 3:
		if x == i:
			_cells[i].color = Color("f59e0b") if marked[i] else Color("1d4ed8")
		else:
			_cells[i].color = Color("22c55e") if marked[i] else Color("1f2937")

func _input(event) -> void:
	if event is InputEventKey and event.pressed and not event.echo:
		if event.keycode == KEY_RIGHT:
			x = mini(2, x + 1)
		elif event.keycode == KEY_LEFT:
			x = maxi(0, x - 1)
		elif event.keycode == KEY_SPACE:
			marked[x] = true
		_refresh()
'''

READY_TSX = BTN_FRAME + r'''
type GameState = {
  phase: 'ready' | 'countdown' | 'playing';
  remainMs: number;
  score: number;
  pulses: number;
};

const { store, commitChange, bindStore } = createGameStore({
  phase: 'ready',
  remainMs: 0,
  score: 0,
  pulses: 0,
} satisfies GameState);

function StartBtn() {
  const [node, setNode] = createSignal<VirtualNode | undefined>();
  const hover = useNodeHover(node);
  const active = useNodeActive(node);
  return (
    <group
      x={440}
      y={200}
      width={400}
      height={160}
      clickable
      virtualNodeRef={setNode}
      onClick={() => {
        commitChange('start', (draft: GameState) => {
          if (draft.phase !== 'ready') return;
          draft.phase = 'countdown';
          draft.remainMs = 3000;
        });
      }}
    >
      <node x={0} y={0} width={400} height={160} shape="roundedRect(32 32 32 32)" backgroundColor={active() ? '#1d4ed8' : hover() ? '#3b82f6' : '#2563eb'} />
      <text x={0} y={32} width={400} height={96} text="Start" textAlign="center" textSize={64} textColor="#ffffff" />
    </group>
  );
}

function PlayZone() {
  const [node, setNode] = createSignal<VirtualNode | undefined>();
  return (
    <node
      x={0}
      y={480}
      width={1280}
      height={240}
      clickable
      virtualNodeRef={setNode}
      backgroundColor={store.phase === 'playing' ? '#14532d' : '#111827'}
      onClick={() => {
        commitChange('hit', (draft: GameState) => {
          if (draft.phase === 'playing') draft.score += 1;
        });
      }}
    />
  );
}

function App() {
  useFrame((frame) => {
    const dt = frame.deltaSeconds;
    if (dt <= 0) return;
    commitChange('tick', (draft: GameState) => {
      if (draft.phase !== 'countdown') return;
      draft.remainMs = Math.max(0, draft.remainMs - Math.round(dt * 1000));
      if (draft.remainMs <= 0) {
        draft.remainMs = 0;
        draft.phase = 'playing';
      }
    });
  });
  return (
    <scene
      name="main"
      width={1280}
      height={720}
      backgroundColor="#0f1224"
      onKeyDown={(e) => {
        if (e.detail?.code === 'Space') {
          commitChange('pulse', (draft: GameState) => {
            if (draft.phase === 'playing') draft.pulses += 1;
          });
        }
      }}
    >
      <PlayZone />
      <text x={48} y={24} width={1184} height={80} text={`phase=${store.phase} remainMs=${store.remainMs} score=${store.score} pulses=${store.pulses}`} textColor="#fff" textSize={36} />
      <StartBtn />
    </scene>
  );
}
renderGame(() => <App />, { bindStore });
'''

READY_GD = r'''extends Node2D
var phase: String = "ready"
var remainMs: int = 0
var score: int = 0
var pulses: int = 0
var _hud: Label
var _start: ColorRect
var _play: ColorRect

func _ready() -> void:
	var bg := ColorRect.new()
	bg.position = Vector2.ZERO
	bg.size = Vector2(1280, 720)
	bg.color = Color("0f1224")
	bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(bg)
	_play = ColorRect.new()
	_play.position = Vector2(0, 480)
	_play.size = Vector2(1280, 240)
	_play.color = Color("111827")
	_play.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_play)
	_hud = Label.new()
	_hud.position = Vector2(48, 24)
	_hud.size = Vector2(1184, 80)
	_hud.add_theme_font_size_override("font_size", 36)
	add_child(_hud)
	_start = ColorRect.new()
	_start.position = Vector2(440, 200)
	_start.size = Vector2(400, 160)
	_start.color = Color("2563eb")
	_start.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_start)
	var lab := Label.new()
	lab.position = Vector2(440, 232)
	lab.size = Vector2(400, 96)
	lab.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	lab.text = "Start"
	lab.add_theme_font_size_override("font_size", 64)
	add_child(lab)
	_refresh()

func _refresh() -> void:
	_hud.text = "phase=%s remainMs=%s score=%s pulses=%s" % [phase, remainMs, score, pulses]
	_play.color = Color("14532d") if phase == "playing" else Color("111827")

func _process(dt: float) -> void:
	if phase != "countdown":
		return
	var step := int(round(dt * 1000.0))
	if step <= 0:
		return
	remainMs = maxi(0, remainMs - step)
	if remainMs <= 0:
		remainMs = 0
		phase = "playing"
	_refresh()

func _input(event) -> void:
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		var p = event.position
		if p.x >= 440 and p.x < 840 and p.y >= 200 and p.y < 360:
			if phase == "ready":
				phase = "countdown"
				remainMs = 3000
		elif p.x >= 0 and p.x < 1280 and p.y >= 480 and p.y < 720:
			if phase == "playing":
				score += 1
		_refresh()
	if event is InputEventKey and event.pressed and not event.echo and event.keycode == KEY_SPACE:
		if phase == "playing":
			pulses += 1
			_refresh()
'''


def main():
    emit_task(
        {
            "id": "p1-signal-desk",
            "fields": {
                "lamp": {"type": "boolean"},
                "channel": {"enum": ["A", "B", "C"]},
                "armed": {"type": "boolean"},
                "shots": {"type": "integer", "minimum": 0},
            },
            "instruction": """标题：信号台

做一个 1280×720 的控制室微游戏。玩家在一张信号台上开关灯、选频道、上膛再发射。

玩家体验：
- 灯有开/关两种外观，按钮文案 Toggle。
- 三个频道按钮文案必须是 A、B、C，同一时刻只有一个被选中，选中项外观不同。
- Arm 上膛后按钮发亮；只有 armed 为真时点 Fire 才会 shots 加 1，并解除上膛。未上膛点 Fire 什么也不变。
- 点空白（dead）不得改状态。
- 顶部状态条必须能读出 lamp、channel、armed、shots。

状态字段：
- lamp: 布尔，初始 false
- channel: 只能是 A、B 或 C，初始 A
- armed: 布尔，初始 false
- shots: 整数，初始 0
""",
            "geom": {
                "regions": {
                    "toggle": {"x": 80, "y": 140, "w": 240, "h": 120},
                    "chanA": {"x": 400, "y": 140, "w": 200, "h": 120},
                    "chanB": {"x": 640, "y": 140, "w": 200, "h": 120},
                    "chanC": {"x": 880, "y": 140, "w": 200, "h": 120},
                    "arm": {"x": 200, "y": 400, "w": 360, "h": 160},
                    "fire": {"x": 720, "y": 400, "w": 360, "h": 160},
                    "dead": {"x": 0, "y": 600, "w": 160, "h": 120},
                },
                "labels": {"toggle": "Toggle", "chanA": "A", "chanB": "B", "chanC": "C", "arm": "Arm", "fire": "Fire"},
            },
            "pos_steps": [
                {"id": "cp0", "checkpoint": "init"},
                {"id": "t", "click": "toggle"},
                {"id": "b", "click": "chanB"},
                {"id": "a", "click": "arm"},
                {"id": "f", "click": "fire"},
                {"id": "cp1", "checkpoint": "final"},
            ],
            "neg_steps": [
                {"id": "cp0", "checkpoint": "init"},
                {"id": "miss", "click": "dead"},
                {"id": "f0", "click": "fire"},
                {"id": "cp1", "checkpoint": "neg_final"},
            ],
            "checks": {
                "init": {"lamp": False, "channel": "A", "armed": False, "shots": 0},
                "final": {"lamp": True, "channel": "B", "armed": False, "shots": 1},
                "neg_final": {"lamp": False, "channel": "A", "armed": False, "shots": 0},
            },
            "tsx": SIGNAL_TSX,
            "gd": SIGNAL_GD,
        }
    )
    emit_task(
        {
            "id": "p1-grid-scout",
            "fields": {
                "x": {"type": "integer", "minimum": 0, "maximum": 2},
                "marked": {"type": "array", "minItems": 3, "maxItems": 3, "items": {"type": "boolean"}},
            },
            "instruction": """标题：格子探路

做一个 1280×720 的空间微游戏。不要处理指针点击。玩家在横排三格上移动斥候，并用空格在当前格留下标记。

玩家体验：
- 三格从左到右排开，当前格必须比另外两格更亮或颜色不同。
- 已标记的格子外观与未标记不同。
- ArrowRight 增加 x，ArrowLeft 减少 x，超出 0..2 则夹紧。
- 按下 Space：把当前 x 对应格子标为已标记，不可取消。
- 顶部状态条必须能读出 x 与三格标记。

状态字段：
- x: 整数 0..2，初始 1
- marked: 三个布尔的数组，初始全 false，下标 0、1、2 对应左中右格
""",
            "constraint": """## 实现约束

- 画面逻辑尺寸 1280×720。
- 三格必须覆盖下列矩形（左上角 x,y 与宽高）。
- 状态字段名与类型必须与题面一致。
- 禁止随机；禁止用物理决定对错。
- 不要实现评测探测接口；不要读取 playplan 或 checkpoint 文件。
""".strip(),
            "geom": {
                "regions": {
                    "cell0": {"x": 80, "y": 200, "w": 320, "h": 320},
                    "cell1": {"x": 480, "y": 200, "w": 320, "h": 320},
                    "cell2": {"x": 880, "y": 200, "w": 320, "h": 320},
                },
                "labels": {},
            },
            "pos_steps": [
                {"id": "cp0", "checkpoint": "init"},
                {"id": "kr", "keydown": "ArrowRight"},
                {"id": "ur", "keyup": "ArrowRight"},
                {"id": "s1d", "keydown": "Space"},
                {"id": "s1u", "keyup": "Space"},
                {"id": "kl1", "keydown": "ArrowLeft"},
                {"id": "ul1", "keyup": "ArrowLeft"},
                {"id": "kl2", "keydown": "ArrowLeft"},
                {"id": "ul2", "keyup": "ArrowLeft"},
                {"id": "s0d", "keydown": "Space"},
                {"id": "s0u", "keyup": "Space"},
                {"id": "cp1", "checkpoint": "final"},
            ],
            "neg_steps": [
                {"id": "cp0", "checkpoint": "init"},
                {"id": "kl1", "keydown": "ArrowLeft"},
                {"id": "ul1", "keyup": "ArrowLeft"},
                {"id": "kl2", "keydown": "ArrowLeft"},
                {"id": "ul2", "keyup": "ArrowLeft"},
                {"id": "kl3", "keydown": "ArrowLeft"},
                {"id": "ul3", "keyup": "ArrowLeft"},
                {"id": "cp1", "checkpoint": "neg_final"},
            ],
            "checks": {
                "init": {"x": 1, "marked": [False, False, False]},
                "final": {"x": 0, "marked": [True, False, True]},
                "neg_final": {"x": 0, "marked": [False, False, False]},
            },
            "tsx": GRID_TSX,
            "gd": GRID_GD,
        }
    )
    emit_task(
        {
            "id": "p1-ready-run",
            "fields": {
                "phase": {"enum": ["ready", "countdown", "playing"]},
                "remainMs": {"type": "integer", "minimum": 0},
                "score": {"type": "integer", "minimum": 0},
                "pulses": {"type": "integer", "minimum": 0},
            },
            "compare_extra": {"remainMs_lte": 0},
            "instruction": """标题：开局街机

做一个 1280×720 的街机微游戏。先按 Start 进入倒计时，时间走完才能得分。

玩家体验：
- 开局停在 ready，Start 按钮文案必须是 Start。点中后进入 countdown，remainMs 变成 3000。
- countdown 期间每帧减少 remainMs；到 0 时 phase 变成 playing，底部得分区变亮。
- 只有 playing 时点底部 play 区 score 加 1；ready 或 countdown 时点 play 区不得加分。
- 只有 playing 时按 Space，pulses 加 1。
- 点 dead 区不得改状态。ready 时走时钟不得自行进入 countdown。
- 顶部状态条必须能读出 phase、remainMs、score、pulses。

状态字段：
- phase: 只能是 ready、countdown 或 playing，初始 ready
- remainMs: 整数，初始 0
- score: 整数，初始 0
- pulses: 整数，初始 0
""",
            "geom": {
                "regions": {
                    "start": {"x": 440, "y": 200, "w": 400, "h": 160},
                    "play": {"x": 0, "y": 480, "w": 1280, "h": 240},
                    "dead": {"x": 0, "y": 0, "w": 200, "h": 80},
                },
                "labels": {"start": "Start"},
            },
            "pos_steps": [
                {"id": "cp0", "checkpoint": "init"},
                {"id": "st", "click": "start"},
                {"id": "mid", "checkpoint": "after_start"},
                {"id": "wait", "tick": 188},
                {"id": "hit", "click": "play"},
                {"id": "pd", "keydown": "Space"},
                {"id": "pu", "keyup": "Space"},
                {"id": "cp1", "checkpoint": "final"},
            ],
            "neg_steps": [
                {"id": "cp0", "checkpoint": "init"},
                {"id": "miss", "click": "dead"},
                {"id": "idle", "tick": 10},
                {"id": "hit0", "click": "play"},
                {"id": "cp1", "checkpoint": "neg_final"},
            ],
            "checks": {
                "init": {"phase": "ready", "remainMs": 0, "score": 0, "pulses": 0},
                "after_start": {"phase": "countdown", "score": 0, "pulses": 0},
                "final": {"phase": "playing", "remainMs": 0, "score": 1, "pulses": 1},
                "neg_final": {"phase": "ready", "remainMs": 0, "score": 0, "pulses": 0},
            },
            "tsx": READY_TSX,
            "gd": READY_GD,
        }
    )


if __name__ == "__main__":
    main()
