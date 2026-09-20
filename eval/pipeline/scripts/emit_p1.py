#!/usr/bin/env python3
"""Emit frozen P1 compare-task trees. Run from repo: python3 eval/pipeline/scripts/emit_p1.py"""
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

BANNED = ["ColorRect", "Autoload", "bindStore", "CharacterBody2D", "<node>", "For", "createGameStore", "Godot", "1game"]


def region_block(geom: dict) -> str:
    lines = []
    for name, r in geom["regions"].items():
        label = (geom.get("labels") or {}).get(name, "")
        extra = f' 文案 "{label}"' if label else ""
        lines.append(f"- `{name}`: x={r['x']}, y={r['y']}, w={r['w']}, h={r['h']}{extra}")
    return "\n".join(lines)


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


PROJECT_GODOT = """config_version=5

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

TSCN = """[gd_scene load_steps=2 format=3 uid="uid://eval{name}"]

[ext_resource type="Script" path="res://game.gd" id="1_game"]

[node name="Game" type="Node2D"]
script = ExtResource("1_game")
"""

BTN_TSX = r'''
import { createSignal } from 'solid-js';
import {
  createGameStore,
  renderGame,
  useNodeActive,
  useNodeHover,
  type VirtualNode,
} from '@1game/engine-bundle/runtime/worker';
'''.strip()


def button_tsx(fn, label, x, y, w, h, on_click_body, extra_store_text=""):
    return f'''
function {fn}() {{
  const [node, setNode] = createSignal<VirtualNode | undefined>();
  const hover = useNodeHover(node);
  const active = useNodeActive(node);
  return (
    <group
      x={{{x}}}
      y={{{y}}}
      width={{{w}}}
      height={{{h}}}
      clickable
      virtualNodeRef={{setNode}}
      onClick={{() => {{
        commitChange('{fn}', (draft: GameState) => {{
{on_click_body}
        }});
      }}}}
    >
      <node
        x={{0}}
        y={{0}}
        width={{{w}}}
        height={{{h}}}
        shape="roundedRect(32 32 32 32)"
        backgroundColor={{active() ? '#1d4ed8' : hover() ? '#3b82f6' : '#2563eb'}}
      />
      <text x={{0}} y={{32}} width={{{w}}} height={{96}} text="{label}" textAlign="center" textSize={{64}} textColor="#ffffff" />
    </group>
  );
}}
'''


def rect_hit(name, r):
    return f'(p.x>={r["x"]} and p.x<{r["x"]+r["w"]} and p.y>={r["y"]} and p.y<{r["y"]+r["h"]})'


def gd_visual(geom, *, state: str, hud: str, input_body: str = "", extra_refresh: str = "\tpass", extra_input: str = ""):
    labels = geom.get("labels") or {}
    adds = []
    for name, r in (geom.get("regions") or {}).items():
        if name == "dead":
            continue
        lab = labels.get(name, "")
        adds.append(f'\t_add_btn("{name}", {r["x"]}, {r["y"]}, {r["w"]}, {r["h"]}, "{lab}")')
    add_block = "\n".join(adds) if adds else "\tpass"
    mouse = ""
    if input_body.strip():
        mouse = f"""	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		var p = event.position
{input_body.rstrip()}
		_refresh()
"""
    input_fn = extra_input + (mouse if mouse else "\tpass\n")
    return f'''extends Node2D
{state}
var _hud: Label
var _btns: Dictionary = {{}}

func _ready() -> void:
	var bg := ColorRect.new()
	bg.position = Vector2.ZERO
	bg.size = Vector2(1280, 720)
	bg.color = Color("0f1224")
	bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(bg)
	_hud = Label.new()
	_hud.position = Vector2(48, 32)
	_hud.size = Vector2(1184, 96)
	_hud.add_theme_font_size_override("font_size", 64)
	add_child(_hud)
{add_block}
	_refresh()

func _add_btn(id: String, x: int, y: int, w: int, h: int, caption: String) -> void:
	var r := ColorRect.new()
	r.position = Vector2(x, y)
	r.size = Vector2(w, h)
	r.color = Color("2563eb")
	r.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(r)
	_btns[id] = r
	if caption != "":
		var lab := Label.new()
		lab.position = Vector2(x, y + maxi(0, int(h / 2) - 48))
		lab.size = Vector2(w, mini(h, 96))
		lab.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		lab.text = caption
		lab.add_theme_font_size_override("font_size", 64)
		add_child(lab)

func _refresh() -> void:
	_hud.text = {hud}
{extra_refresh}

func _input(event) -> void:
{input_fn}
'''


# ---------- task definitions ----------

TASKS_DEF = []


def add(**kw):
    if callable(kw.get("gd")):
        kw["gd"] = kw["gd"](kw)
    TASKS_DEF.append(kw)


add(
    id="p1-toggle-lamp",
    title="拨灯",
    fields={"on": {"type": "boolean"}},
    store_ts="on: boolean",
    init_store="on: false",
    instruction="""标题：拨灯

做一个 1280×720 的小游戏。

状态字段：
- on: 布尔，初始 false

只有一块按钮可点，文案必须是 Toggle。
每次点中按钮：on 取反。
点按钮以外不得改变 on。
""",
    geom={
        "regions": {"toggle": {"x": 440, "y": 280, "w": 400, "h": 160}, "dead": {"x": 0, "y": 0, "w": 320, "h": 160}},
        "labels": {"toggle": "Toggle"},
        "frozen_click_centers": ["160,80"],
    },
    pos_steps=[
        {"id": "cp0", "checkpoint": "init"},
        {"id": "c1", "click": "toggle"},
        {"id": "cp1", "checkpoint": "final"},
    ],
    neg_steps=[
        {"id": "cp0", "checkpoint": "init"},
        {"id": "miss", "click": "dead"},
        {"id": "cp1", "checkpoint": "neg_final"},
    ],
    checks={"init": {"on": False}, "final": {"on": True}, "neg_final": {"on": False}},
    tsx_logic='''
const { store, commitChange, bindStore } = createGameStore({ on: false } satisfies GameState);
'''
    + button_tsx("ToggleBtn", "Toggle", 440, 280, 400, 160, "          draft.on = !draft.on;")
    + '''
function App() {
  return (
    <scene name="main" width={1280} height={720} backgroundColor="#0f1224" >
      <text x={48} y={32} width={1184} height={96} text={store.on ? 'on' : 'off'} textColor="#fff" textSize={64} />
      <ToggleBtn />
    </scene>
  );
}
renderGame(() => <App />, { bindStore });
''',
    gd=lambda t: gd_visual(
        t["geom"],
        state="var on: bool = false",
        hud='"on" if on else "off"',
        input_body="""		if p.x >= 440 and p.x < 840 and p.y >= 280 and p.y < 440:
			on = not on
""",
        extra_refresh="""	if _btns.has("toggle"):
		_btns["toggle"].color = Color("fbbf24") if on else Color("2563eb")
""",
    ),
)

add(
    id="p1-counter-clamp",
    title="加减夹紧",
    fields={"value": {"type": "integer", "minimum": 0, "maximum": 3}},
    instruction="""标题：加减夹紧

做一个 1280×720 的小游戏。

状态字段：
- value: 整数，初始 0，范围 0 到 3（含）

两块按钮：Plus 使 value 加 1（已到 3 则保持 3）；Minus 使 value 减 1（已到 0 则保持 0）。
点按钮以外不得改变 value。
""",
    geom={
        "regions": {
            "plus": {"x": 720, "y": 280, "w": 320, "h": 160},
            "minus": {"x": 240, "y": 280, "w": 320, "h": 160},
            "dead": {"x": 0, "y": 0, "w": 160, "h": 160},
        },
        "labels": {"plus": "Plus", "minus": "Minus"},
        "frozen_click_centers": ["80,80"],
    },
    pos_steps=[
        {"id": "cp0", "checkpoint": "init"},
        {"id": "p1", "click": "plus"},
        {"id": "p2", "click": "plus"},
        {"id": "p3", "click": "plus"},
        {"id": "p4", "click": "plus"},
        {"id": "cp1", "checkpoint": "final"},
    ],
    neg_steps=[
        {"id": "cp0", "checkpoint": "init"},
        {"id": "m1", "click": "minus"},
        {"id": "cp1", "checkpoint": "neg_final"},
    ],
    checks={"init": {"value": 0}, "final": {"value": 3}, "neg_final": {"value": 0}},
    tsx_logic='''
const { store, commitChange, bindStore } = createGameStore({ value: 0 } satisfies GameState);
'''
    + button_tsx("PlusBtn", "Plus", 720, 280, 320, 160, "          draft.value = Math.min(3, draft.value + 1);")
    + button_tsx("MinusBtn", "Minus", 240, 280, 320, 160, "          draft.value = Math.max(0, draft.value - 1);")
    + '''
function App() {
  return (
    <scene name="main" width={1280} height={720} backgroundColor="#0f1224">
      <text x={48} y={32} width={1184} height={96} text={String(store.value)} textColor="#fff" textSize={64} />
      <MinusBtn />
      <PlusBtn />
    </scene>
  );
}
renderGame(() => <App />, { bindStore });
''',
    gd=lambda t: gd_visual(
        t["geom"],
        state="var value: int = 0",
        hud="str(value)",
        input_body="""		if p.x >= 720 and p.x < 1040 and p.y >= 280 and p.y < 440:
			value = mini(3, value + 1)
		elif p.x >= 240 and p.x < 560 and p.y >= 280 and p.y < 440:
			value = maxi(0, value - 1)
""",
    ),
)

add(
    id="p1-pick-slot",
    title="三槽选择",
    fields={"slot": {"enum": ["A", "B", "C"]}},
    instruction="""标题：三槽选择

做一个 1280×720 的小游戏。

状态字段：
- slot: 字符串，只能是 A、B 或 C，初始 A

三块按钮文案必须是 A、B、C。点中某按钮后 slot 变成该文案。
点按钮以外不得改变 slot。
""",
    geom={
        "regions": {
            "slotA": {"x": 80, "y": 280, "w": 320, "h": 160},
            "slotB": {"x": 480, "y": 280, "w": 320, "h": 160},
            "slotC": {"x": 880, "y": 280, "w": 320, "h": 160},
            "dead": {"x": 0, "y": 0, "w": 160, "h": 120},
        },
        "labels": {"slotA": "A", "slotB": "B", "slotC": "C"},
        "frozen_click_centers": ["80,60"],
    },
    pos_steps=[
        {"id": "cp0", "checkpoint": "init"},
        {"id": "b", "click": "slotB"},
        {"id": "c", "click": "slotC"},
        {"id": "cp1", "checkpoint": "final"},
    ],
    neg_steps=[
        {"id": "cp0", "checkpoint": "init"},
        {"id": "miss", "click": "dead"},
        {"id": "cp1", "checkpoint": "neg_final"},
    ],
    checks={"init": {"slot": "A"}, "final": {"slot": "C"}, "neg_final": {"slot": "A"}},
    tsx_logic='''
const { store, commitChange, bindStore } = createGameStore({ slot: 'A' as 'A' | 'B' | 'C' } satisfies GameState);
'''
    + button_tsx("BtnA", "A", 80, 280, 320, 160, "          draft.slot = 'A';")
    + button_tsx("BtnB", "B", 480, 280, 320, 160, "          draft.slot = 'B';")
    + button_tsx("BtnC", "C", 880, 280, 320, 160, "          draft.slot = 'C';")
    + '''
function App() {
  return (
    <scene name="main" width={1280} height={720} backgroundColor="#0f1224">
      <text x={48} y={32} width={1184} height={96} text={store.slot} textColor="#fff" textSize={64} />
      <BtnA />
      <BtnB />
      <BtnC />
    </scene>
  );
}
renderGame(() => <App />, { bindStore });
''',
    gd=lambda t: gd_visual(
        t["geom"],
        state='var slot: String = "A"',
        hud="slot",
        input_body="""		if p.x >= 80 and p.x < 400 and p.y >= 280 and p.y < 440:
			slot = "A"
		elif p.x >= 480 and p.x < 800 and p.y >= 280 and p.y < 440:
			slot = "B"
		elif p.x >= 880 and p.x < 1200 and p.y >= 280 and p.y < 440:
			slot = "C"
""",
        extra_refresh="""	for id in ["slotA", "slotB", "slotC"]:
		if _btns.has(id):
			_btns[id].color = Color("1d4ed8") if slot == id.substr(4) else Color("2563eb")
""",
    ),
)

add(
    id="p1-arm-fire",
    title="先上膛再开火",
    fields={"armed": {"type": "boolean"}, "shots": {"type": "integer", "minimum": 0}},
    instruction="""标题：先上膛再开火

做一个 1280×720 的小游戏。

状态字段：
- armed: 布尔，初始 false
- shots: 整数，初始 0

两块按钮：Arm、Fire。
点 Arm：armed 变成 true。
点 Fire：仅当 armed 为 true 时 shots 加 1 且 armed 变成 false；否则什么也不变。
点按钮以外不得改变状态。
""",
    geom={
        "regions": {
            "arm": {"x": 200, "y": 280, "w": 360, "h": 160},
            "fire": {"x": 720, "y": 280, "w": 360, "h": 160},
        },
        "labels": {"arm": "Arm", "fire": "Fire"},
        "frozen_click_centers": [],
    },
    pos_steps=[
        {"id": "cp0", "checkpoint": "init"},
        {"id": "f0", "click": "fire"},
        {"id": "a1", "click": "arm"},
        {"id": "f1", "click": "fire"},
        {"id": "cp1", "checkpoint": "final"},
    ],
    neg_steps=[
        {"id": "cp0", "checkpoint": "init"},
        {"id": "f0", "click": "fire"},
        {"id": "f1", "click": "fire"},
        {"id": "cp1", "checkpoint": "neg_final"},
    ],
    checks={"init": {"armed": False, "shots": 0}, "final": {"armed": False, "shots": 1}, "neg_final": {"armed": False, "shots": 0}},
    tsx_logic='''
const { store, commitChange, bindStore } = createGameStore({ armed: false, shots: 0 } satisfies GameState);
'''
    + button_tsx("ArmBtn", "Arm", 200, 280, 360, 160, "          draft.armed = true;")
    + button_tsx("FireBtn", "Fire", 720, 280, 360, 160, "          if (draft.armed) { draft.shots += 1; draft.armed = false; }")
    + '''
function App() {
  return (
    <scene name="main" width={1280} height={720} backgroundColor="#0f1224">
      <text x={48} y={32} width={1184} height={96} text={`armed=${store.armed} shots=${store.shots}`} textColor="#fff" textSize={64} />
      <ArmBtn />
      <FireBtn />
    </scene>
  );
}
renderGame(() => <App />, { bindStore });
''',
    gd=lambda t: gd_visual(
        t["geom"],
        state="var armed: bool = false\nvar shots: int = 0",
        hud='"armed=%s shots=%s" % [armed, shots]',
        input_body="""		if p.x >= 200 and p.x < 560 and p.y >= 280 and p.y < 440:
			armed = true
		elif p.x >= 720 and p.x < 1080 and p.y >= 280 and p.y < 440:
			if armed:
				shots += 1
				armed = false
""",
        extra_refresh="""	if _btns.has("arm"):
		_btns["arm"].color = Color("fbbf24") if armed else Color("2563eb")
""",
    ),
)

add(
    id="p1-grid-step",
    title="格子走动",
    fields={"x": {"type": "integer", "minimum": 0, "maximum": 2}, "y": {"type": "integer", "minimum": 0, "maximum": 2}},
    instruction="""标题：格子走动

做一个 1280×720 的小游戏。不要处理指针点击。

状态字段：
- x: 整数 0..2，初始 1
- y: 整数 0..2，初始 1

方向键每次把坐标移动 1 格，超出 0..2 则夹紧。
ArrowRight 增加 x，ArrowLeft 减少 x，ArrowDown 增加 y，ArrowUp 减少 y。
""",
    geom={"regions": {}, "labels": {}, "frozen_click_centers": []},
    pos_steps=[
        {"id": "cp0", "checkpoint": "init"},
        {"id": "kr", "keydown": "ArrowRight"},
        {"id": "ur", "keyup": "ArrowRight"},
        {"id": "ku", "keydown": "ArrowUp"},
        {"id": "uu", "keyup": "ArrowUp"},
        {"id": "cp1", "checkpoint": "final"},
    ],
    neg_steps=[
        {"id": "cp0", "checkpoint": "init"},
        {"id": "kl1", "keydown": "ArrowLeft"},
        {"id": "ul1", "keyup": "ArrowLeft"},
        {"id": "kl2", "keydown": "ArrowLeft"},
        {"id": "ul2", "keyup": "ArrowLeft"},
        {"id": "kl3", "keydown": "ArrowLeft"},
        {"id": "ul3", "keyup": "ArrowLeft"},
        {"id": "cp1", "checkpoint": "neg_final"},
    ],
    checks={"init": {"x": 4, "y": 4}, "final": {"x": 8, "y": 0}, "neg_final": {"x": 0, "y": 4}},
    tsx_logic='''
const { store, commitChange, bindStore } = createGameStore({ x: 1, y: 1 } satisfies GameState);
function nudge(code: string) {
  commitChange('nudge', (draft: GameState) => {
    if (code === 'ArrowRight') draft.x = Math.min(2, draft.x + 1);
    if (code === 'ArrowLeft') draft.x = Math.max(0, draft.x - 1);
    if (code === 'ArrowDown') draft.y = Math.min(2, draft.y + 1);
    if (code === 'ArrowUp') draft.y = Math.max(0, draft.y - 1);
  });
}
function App() {
  return (
    <scene name="main" width={1280} height={720} backgroundColor="#0f1224" onKeyDown={(e) => nudge(e.detail?.code)}>
      <text x={48} y={32} width={1184} height={96} text={`${store.x},${store.y}`} textColor="#fff" textSize={64} />
    </scene>
  );
}
renderGame(() => <App />, { bindStore });
''',
    gd=lambda t: gd_visual(
        t["geom"],
        state="var x: int = 1\nvar y: int = 1",
        hud='"%s,%s" % [x, y]',
        extra_input="""	if event is InputEventKey and event.pressed and not event.echo:
		if event.keycode == KEY_RIGHT:
			x = mini(2, x + 1)
		elif event.keycode == KEY_LEFT:
			x = maxi(0, x - 1)
		elif event.keycode == KEY_DOWN:
			y = mini(2, y + 1)
		elif event.keycode == KEY_UP:
			y = maxi(0, y - 1)
		_refresh()
""",
    ),
)

add(
    id="p1-seq-ab",
    title="顺序 AB",
    fields={"stage": {"type": "integer", "minimum": 0, "maximum": 2}},
    instruction="""标题：顺序 AB

做一个 1280×720 的小游戏。

状态字段：
- stage: 整数，只能是 0、1、2，初始 0

两块按钮：A、B。
stage 为 0 时只有点 A 会变成 1。
stage 为 1 时只有点 B 会变成 2。
其它点击不得改变 stage。
""",
    geom={
        "regions": {
            "btnA": {"x": 200, "y": 280, "w": 360, "h": 160},
            "btnB": {"x": 720, "y": 280, "w": 360, "h": 160},
        },
        "labels": {"btnA": "A", "btnB": "B"},
        "frozen_click_centers": [],
    },
    pos_steps=[
        {"id": "cp0", "checkpoint": "init"},
        {"id": "a", "click": "btnA"},
        {"id": "b", "click": "btnB"},
        {"id": "cp1", "checkpoint": "final"},
    ],
    neg_steps=[
        {"id": "cp0", "checkpoint": "init"},
        {"id": "b0", "click": "btnB"},
        {"id": "cp1", "checkpoint": "neg_final"},
    ],
    checks={"init": {"stage": 0}, "final": {"stage": 2}, "neg_final": {"stage": 0}},
    tsx_logic='''
const { store, commitChange, bindStore } = createGameStore({ stage: 0 } satisfies GameState);
'''
    + button_tsx("BtnA", "A", 200, 280, 360, 160, "          if (draft.stage === 0) draft.stage = 1;")
    + button_tsx("BtnB", "B", 720, 280, 360, 160, "          if (draft.stage === 1) draft.stage = 2;")
    + '''
function App() {
  return (
    <scene name="main" width={1280} height={720} backgroundColor="#0f1224">
      <text x={48} y={32} width={1184} height={96} text={String(store.stage)} textColor="#fff" textSize={64} />
      <BtnA />
      <BtnB />
    </scene>
  );
}
renderGame(() => <App />, { bindStore });
''',
    gd=lambda t: gd_visual(
        t["geom"],
        state="var stage: int = 0",
        hud="str(stage)",
        input_body="""		if p.x >= 200 and p.x < 560 and p.y >= 280 and p.y < 440:
			if stage == 0:
				stage = 1
		elif p.x >= 720 and p.x < 1080 and p.y >= 280 and p.y < 440:
			if stage == 1:
				stage = 2
""",
        extra_refresh="""	if _btns.has("btnA"):
		_btns["btnA"].color = Color("1d4ed8") if stage == 0 else Color("2563eb")
	if _btns.has("btnB"):
		_btns["btnB"].color = Color("1d4ed8") if stage == 1 else Color("2563eb")
""",
    ),
)

add(
    id="p1-tab-act",
    title="分栏计数",
    fields={
        "tab": {"enum": ["red", "blue"]},
        "count_red": {"type": "integer", "minimum": 0},
        "count_blue": {"type": "integer", "minimum": 0},
    },
    instruction="""标题：分栏计数

做一个 1280×720 的小游戏。

状态字段：
- tab: 字符串，只能是 red 或 blue，初始 red
- count_red: 整数，初始 0
- count_blue: 整数，初始 0

三块按钮：Red、Blue、Act。
点 Red：tab 变成 red。点 Blue：tab 变成 blue。
点 Act：若 tab 为 red 则 count_red 加 1；若 tab 为 blue 则 count_blue 加 1。
点按钮以外不得改变状态。
""",
    geom={
        "regions": {
            "red": {"x": 80, "y": 80, "w": 280, "h": 128},
            "blue": {"x": 400, "y": 80, "w": 280, "h": 128},
            "act": {"x": 440, "y": 360, "w": 400, "h": 160},
        },
        "labels": {"red": "Red", "blue": "Blue", "act": "Act"},
        "frozen_click_centers": [],
    },
    pos_steps=[
        {"id": "cp0", "checkpoint": "init"},
        {"id": "a1", "click": "act"},
        {"id": "b1", "click": "blue"},
        {"id": "a2", "click": "act"},
        {"id": "cp1", "checkpoint": "final"},
    ],
    neg_steps=[
        {"id": "cp0", "checkpoint": "init"},
        {"id": "b1", "click": "blue"},
        {"id": "cp1", "checkpoint": "neg_final"},
    ],
    checks={
        "init": {"tab": "red", "count_red": 0, "count_blue": 0},
        "final": {"tab": "blue", "count_red": 1, "count_blue": 1},
        "neg_final": {"tab": "blue", "count_red": 0, "count_blue": 0},
    },
    tsx_logic='''
const { store, commitChange, bindStore } = createGameStore({ tab: 'red' as 'red' | 'blue', count_red: 0, count_blue: 0 } satisfies GameState);
'''
    + button_tsx("RedBtn", "Red", 80, 80, 280, 128, "          draft.tab = 'red';")
    + button_tsx("BlueBtn", "Blue", 400, 80, 280, 128, "          draft.tab = 'blue';")
    + button_tsx("ActBtn", "Act", 440, 360, 400, 160, "          if (draft.tab === 'red') draft.count_red += 1; else draft.count_blue += 1;")
    + '''
function App() {
  return (
    <scene name="main" width={1280} height={720} backgroundColor="#0f1224">
      <text x={720} y={80} width={480} height={96} text={`${store.tab} ${store.count_red}/${store.count_blue}`} textColor="#fff" textSize={56} />
      <RedBtn />
      <BlueBtn />
      <ActBtn />
    </scene>
  );
}
renderGame(() => <App />, { bindStore });
''',
    gd=lambda t: gd_visual(
        t["geom"],
        state='var tab: String = "red"\nvar count_red: int = 0\nvar count_blue: int = 0',
        hud='"%s %s/%s" % [tab, count_red, count_blue]',
        input_body="""		if p.x >= 80 and p.x < 360 and p.y >= 80 and p.y < 208:
			tab = "red"
		elif p.x >= 400 and p.x < 680 and p.y >= 80 and p.y < 208:
			tab = "blue"
		elif p.x >= 440 and p.x < 840 and p.y >= 360 and p.y < 520:
			if tab == "red":
				count_red += 1
			else:
				count_blue += 1
""",
        extra_refresh="""	if _btns.has("red"):
		_btns["red"].color = Color("dc2626") if tab == "red" else Color("7f1d1d")
	if _btns.has("blue"):
		_btns["blue"].color = Color("2563eb") if tab == "blue" else Color("1e3a8a")
""",
    ),
)

add(
    id="p1-space-pulse",
    title="空格脉冲",
    fields={"held": {"type": "boolean"}, "pulses": {"type": "integer", "minimum": 0}},
    instruction="""标题：空格脉冲

做一个 1280×720 的小游戏。不要处理指针点击。

状态字段：
- held: 布尔，初始 false
- pulses: 整数，初始 0

按下 Space：held 变成 true。
松开 Space：held 变成 false，且 pulses 加 1。
其它键忽略。
""",
    geom={"regions": {}, "labels": {}, "frozen_click_centers": []},
    pos_steps=[
        {"id": "cp0", "checkpoint": "init"},
        {"id": "dn", "keydown": "Space"},
        {"id": "mid", "checkpoint": "held"},
        {"id": "up", "keyup": "Space"},
        {"id": "cp1", "checkpoint": "final"},
    ],
    neg_steps=[
        {"id": "cp0", "checkpoint": "init"},
        {"id": "t1", "tick": 4},
        {"id": "cp1", "checkpoint": "neg_final"},
    ],
    checks={
        "init": {"held": False, "pulses": 0},
        "held": {"held": True, "pulses": 0},
        "final": {"held": False, "pulses": 1},
        "neg_final": {"held": False, "pulses": 0},
    },
    tsx_logic='''
const { store, commitChange, bindStore } = createGameStore({ held: false, pulses: 0 } satisfies GameState);
function App() {
  return (
    <scene
      name="main"
      width={1280}
      height={720}
      backgroundColor="#0f1224"
      onKeyDown={(e) => {
        if (e.detail?.code === 'Space') {
          commitChange('down', (draft: GameState) => {
            draft.held = true;
          });
        }
      }}
      onKeyUp={(e) => {
        if (e.detail?.code === 'Space') {
          commitChange('up', (draft: GameState) => {
            draft.held = false;
            draft.pulses += 1;
          });
        }
      }}
    >
      <text x={48} y={32} width={1184} height={96} text={`held=${store.held} pulses=${store.pulses}`} textColor="#fff" textSize={64} />
    </scene>
  );
}
renderGame(() => <App />, { bindStore });
''',
    gd=lambda t: gd_visual(
        t["geom"],
        state="var held: bool = false\nvar pulses: int = 0",
        hud='"held=%s pulses=%s" % [held, pulses]',
        extra_input="""	if event is InputEventKey and event.keycode == KEY_SPACE and not event.echo:
		if event.pressed:
			held = true
		else:
			held = false
			pulses += 1
		_refresh()
""",
    ),
)

add(
    id="p1-door-pair",
    title="双门",
    fields={"left": {"type": "boolean"}, "right": {"type": "boolean"}},
    instruction="""标题：双门

做一个 1280×720 的小游戏。

状态字段：
- left: 布尔，初始 false
- right: 布尔，初始 false

两块按钮：Left、Right。点 Left 使 left 为 true；点 Right 使 right 为 true。不会关回去。
点按钮以外不得改变状态。
""",
    geom={
        "regions": {
            "left": {"x": 160, "y": 280, "w": 400, "h": 160},
            "right": {"x": 720, "y": 280, "w": 400, "h": 160},
            "dead": {"x": 0, "y": 0, "w": 160, "h": 120},
        },
        "labels": {"left": "Left", "right": "Right"},
        "frozen_click_centers": ["80,60"],
    },
    pos_steps=[
        {"id": "cp0", "checkpoint": "init"},
        {"id": "l", "click": "left"},
        {"id": "r", "click": "right"},
        {"id": "cp1", "checkpoint": "final"},
    ],
    neg_steps=[
        {"id": "cp0", "checkpoint": "init"},
        {"id": "miss", "click": "dead"},
        {"id": "cp1", "checkpoint": "neg_final"},
    ],
    checks={
        "init": {"left": False, "right": False},
        "final": {"left": True, "right": True},
        "neg_final": {"left": False, "right": False},
    },
    tsx_logic='''
const { store, commitChange, bindStore } = createGameStore({ left: false, right: false } satisfies GameState);
'''
    + button_tsx("LeftBtn", "Left", 160, 280, 400, 160, "          draft.left = true;")
    + button_tsx("RightBtn", "Right", 720, 280, 400, 160, "          draft.right = true;")
    + '''
function App() {
  return (
    <scene name="main" width={1280} height={720} backgroundColor="#0f1224">
      <text x={48} y={32} width={1184} height={96} text={`${store.left}/${store.right}`} textColor="#fff" textSize={64} />
      <LeftBtn />
      <RightBtn />
    </scene>
  );
}
renderGame(() => <App />, { bindStore });
''',
    gd=lambda t: gd_visual(
        t["geom"],
        state="var left: bool = false\nvar right: bool = false",
        hud='"%s/%s" % [left, right]',
        input_body="""		if p.x >= 160 and p.x < 560 and p.y >= 280 and p.y < 440:
			left = true
		elif p.x >= 720 and p.x < 1120 and p.y >= 280 and p.y < 440:
			right = true
""",
        extra_refresh="""	if _btns.has("left"):
		_btns["left"].color = Color("22c55e") if left else Color("2563eb")
	if _btns.has("right"):
		_btns["right"].color = Color("22c55e") if right else Color("2563eb")
""",
    ),
)

add(
    id="p1-mode-cycle",
    title="模式循环",
    fields={"mode": {"enum": ["stop", "walk", "run"]}},
    instruction="""标题：模式循环

做一个 1280×720 的小游戏。

状态字段：
- mode: 字符串，只能是 stop、walk 或 run，初始 stop

一块按钮文案必须是 Cycle。每次点中：stop→walk→run→stop。
点按钮以外不得改变 mode。
""",
    geom={
        "regions": {
            "cycle": {"x": 440, "y": 280, "w": 400, "h": 160},
            "dead": {"x": 0, "y": 560, "w": 240, "h": 120},
        },
        "labels": {"cycle": "Cycle"},
        "frozen_click_centers": ["120,620"],
    },
    pos_steps=[
        {"id": "cp0", "checkpoint": "init"},
        {"id": "c1", "click": "cycle"},
        {"id": "c2", "click": "cycle"},
        {"id": "cp1", "checkpoint": "final"},
    ],
    neg_steps=[
        {"id": "cp0", "checkpoint": "init"},
        {"id": "miss", "click": "dead"},
        {"id": "cp1", "checkpoint": "neg_final"},
    ],
    checks={"init": {"mode": "stop"}, "final": {"mode": "run"}, "neg_final": {"mode": "stop"}},
    tsx_logic='''
const { store, commitChange, bindStore } = createGameStore({ mode: 'stop' as 'stop' | 'walk' | 'run' } satisfies GameState);
'''
    + button_tsx(
        "CycleBtn",
        "Cycle",
        440,
        280,
        400,
        160,
        "          draft.mode = draft.mode === 'stop' ? 'walk' : draft.mode === 'walk' ? 'run' : 'stop';",
    )
    + '''
function App() {
  return (
    <scene name="main" width={1280} height={720} backgroundColor="#0f1224">
      <text x={48} y={32} width={1184} height={96} text={store.mode} textColor="#fff" textSize={64} />
      <CycleBtn />
    </scene>
  );
}
renderGame(() => <App />, { bindStore });
''',
    gd=lambda t: gd_visual(
        t["geom"],
        state='var mode: String = "stop"',
        hud="mode",
        input_body="""		if p.x >= 440 and p.x < 840 and p.y >= 280 and p.y < 440:
			if mode == "stop":
				mode = "walk"
			elif mode == "walk":
				mode = "run"
			else:
				mode = "stop"
""",
        extra_refresh="""	if _btns.has("cycle"):
		if mode == "stop":
			_btns["cycle"].color = Color("2563eb")
		elif mode == "walk":
			_btns["cycle"].color = Color("22c55e")
		else:
			_btns["cycle"].color = Color("f59e0b")
""",
    ),
)


def tsx_file(task) -> str:
    # infer GameState from fields - keep generated tsx_logic self-contained with type
    fields = task["fields"]
    parts = []
    for k, spec in fields.items():
        if spec.get("type") == "boolean":
            parts.append(f"  {k}: boolean;")
        elif spec.get("type") == "integer":
            parts.append(f"  {k}: number;")
        elif "enum" in spec:
            union = " | ".join(repr(x) for x in spec["enum"])
            parts.append(f"  {k}: {union};")
        else:
            parts.append(f"  {k}: unknown;")
    header = BTN_TSX + "\n\ntype GameState = {\n" + "\n".join(parts) + "\n};\n\n"
    return header + task["tsx_logic"].strip() + "\n"


def emit_task(task):
    tid = task["id"]
    d = TASKS / tid
    schema_id = f"eval.{tid}/1"
    schema = dump_schema(schema_id, task["fields"])
    instr = task["instruction"].strip() + "\n\n" + region_block(task["geom"]) + "\n\n" + CONSTRAINT + "\n"
    for w in BANNED:
        if w in instr:
            raise SystemExit(f"banned word {w} in {tid} instruction")
    write(d / "instruction.md", instr)
    write(d / "task.yaml", f"""id: {tid}
tier: P1
engines: [onegame, godot]
entry: src/game.tsx
scene: {{ count: 1, width: 1280, height: 720 }}
schema: dump.schema.json
judge: schema_strict
rng: forbidden
physics: forbidden
""")
    geom = task["geom"]
    labels = geom.get("labels") or {}
    lines = ["regions:"]
    if not geom["regions"]:
        lines = ["regions: {}"]
    else:
        for n, r in geom["regions"].items():
            lines.append(f"  {n}: {{ x: {r['x']}, y: {r['y']}, w: {r['w']}, h: {r['h']} }}")
    lines.append("labels:")
    if labels:
        for n, lab in labels.items():
            lines.append(f"  {n}: {lab}")
    else:
        lines[-1] = "labels: {}"
    frozen = geom.get("frozen_click_centers") or []
    if frozen:
        lines.append("frozen_click_centers:")
        for c in frozen:
            lines.append(f'  - "{c}"')
    else:
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
            "compare": {"mode": "schema_strict", "extras": "fail"},
            "slices": task["checks"],
        },
    )
    write(ORACLES / tid / "onegame" / "src" / "game.tsx", tsx_file(task))
    write(ORACLES / tid / "godot" / "game.gd", task["gd"].strip() + "\n")
    write(ORACLES / tid / "godot" / "game.tscn", TSCN.format(name=tid.replace("-", "")))
    write(ORACLES / tid / "godot" / "project.godot", PROJECT_GODOT.format(name=tid))


def main():
    ids = []
    for t in TASKS_DEF:
        emit_task(t)
        ids.append(t["id"])
        print("emitted", t["id"])
    print("count", len(ids))


if __name__ == "__main__":
    main()
