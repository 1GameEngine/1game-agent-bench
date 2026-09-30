extends Node2D

const COLS := 8
const ROWS := 6
const OX := 384
const OY := 120
const CELL := 64
const LIMIT := 8
const ALLY_RANK := {"melee": 0, "ranged": 1, "support": 2}
const SPRITE := {
	"melee": "melee.png",
	"ranged": "ranged.png",
	"support": "support.png",
	"brute": "brute.png",
	"shot": "shot.png",
	"lurker": "lurker.png",
}

var phase := "ready"
var turn := 0
var selected := ""
var units: Array = []
var _labels: Array[Label] = []
var _tex: Dictionary = {}

func _ready() -> void:
	units = _opening()
	_label("Depot Skirmish", 80, 12, 1120, 52, 42)
	_label("", 40, 68, 1200, 36, 22)
	_label("", 80, 548, 1120, 56, 40)
	_label("End", 60, 634, 240, 42, 32)
	_label("Start", 440, 634, 400, 42, 32)
	_refresh()
	queue_redraw()

func _opening() -> Array:
	return [
		{"id": "melee", "side": "ally", "c": 1, "r": 4, "hp": 20, "max": 20, "mv": 2, "rng": 1, "atk": 3, "heal": 0, "acted": false},
		{"id": "ranged", "side": "ally", "c": 3, "r": 4, "hp": 16, "max": 16, "mv": 2, "rng": 3, "atk": 3, "heal": 0, "acted": false},
		{"id": "support", "side": "ally", "c": 5, "r": 4, "hp": 16, "max": 16, "mv": 3, "rng": 0, "atk": 0, "heal": 2, "acted": false},
		{"id": "brute", "side": "enemy", "c": 1, "r": 2, "hp": 3, "max": 3, "mv": 1, "rng": 1, "atk": 1, "heal": 0, "acted": false},
		{"id": "shot", "side": "enemy", "c": 3, "r": 2, "hp": 3, "max": 3, "mv": 1, "rng": 3, "atk": 1, "heal": 0, "acted": false},
		{"id": "lurker", "side": "enemy", "c": 6, "r": 2, "hp": 3, "max": 3, "mv": 1, "rng": 1, "atk": 1, "heal": 0, "acted": false},
	]

func _label(text: String, x: float, y: float, w: float, h: float, size: int) -> void:
	var lab := Label.new()
	lab.position = Vector2(x, y)
	lab.size = Vector2(w, h)
	lab.text = text
	lab.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	lab.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	lab.mouse_filter = Control.MOUSE_FILTER_IGNORE
	lab.add_theme_font_size_override("font_size", size)
	lab.add_theme_color_override("font_color", Color("f6e7c1"))
	add_child(lab)
	_labels.append(lab)

func _texture(name: String) -> Texture2D:
	if _tex.has(name):
		return _tex[name]
	var path := "res://assets/%s" % name
	var tex: Texture2D = null
	if ResourceLoader.exists(path):
		tex = load(path)
	_tex[name] = tex
	return tex

func _living(side: String = "") -> Array:
	var out: Array = []
	for u in units:
		if int(u.hp) > 0 and (side == "" or u.side == side):
			out.append(u)
	return out

func _at(c: int, r: int):
	for u in units:
		if int(u.hp) > 0 and int(u.c) == c and int(u.r) == r:
			return u
	return null

func _by_id(id: String):
	for u in units:
		if u.id == id:
			return u
	return null

func _los(u: Dictionary, c: int, r: int):
	if int(u.c) != c and int(u.r) != r:
		return null
	var dist := absi(int(u.c) - c) + absi(int(u.r) - r)
	if dist < 1:
		return null
	var dc := signi(c - int(u.c))
	var dr := signi(r - int(u.r))
	var x := int(u.c) + dc
	var y := int(u.r) + dr
	while x != c or y != r:
		if _at(x, y) != null:
			return null
		x += dc
		y += dr
	return dist

func _reach(u: Dictionary) -> Array:
	var seen := {"%d,%d" % [int(u.c), int(u.r)]: true}
	var frontier: Array = [[int(u.c), int(u.r)]]
	var out: Array = []
	for step in int(u.mv):
		var next: Array = []
		for pos in frontier:
			for delta in [[1, 0], [-1, 0], [0, 1], [0, -1]]:
				var nc: int = int(pos[0]) + int(delta[0])
				var nr: int = int(pos[1]) + int(delta[1])
				var key := "%d,%d" % [nc, nr]
				if nc < 0 or nr < 0 or nc >= COLS or nr >= ROWS or seen.has(key):
					continue
				seen[key] = true
				if _at(nc, nr) != null:
					continue
				next.append([nc, nr])
				out.append([nc, nr])
		frontier = next
	return out

func _settle() -> void:
	var ally_on := false
	for u in _living("ally"):
		if int(u.c) == 3 and int(u.r) == 0:
			ally_on = true
	if ally_on or _living("enemy").is_empty():
		phase = "clear"
	elif _living("ally").is_empty():
		phase = "fail"

func _enemy_phase() -> void:
	for id in ["brute", "shot", "lurker"]:
		var e = _by_id(id)
		if e == null or int(e.hp) <= 0 or phase != "playing":
			continue
		var targets := _living("ally")
		targets.sort_custom(func(a, b): return int(ALLY_RANK[a.id]) < int(ALLY_RANK[b.id]))
		if targets.is_empty():
			break
		var shots: Array = []
		for a in targets:
			var d = _los(e, int(a.c), int(a.r))
			if d != null and int(d) <= int(e.rng):
				shots.append(a)
		if not shots.is_empty():
			shots[0].hp = maxi(0, int(shots[0].hp) - int(e.atk))
			_settle()
			continue
		var goal = targets[0]
		var best := 999
		for a in targets:
			var dist := absi(int(a.c) - int(e.c)) + absi(int(a.r) - int(e.r))
			var rank := int(ALLY_RANK[a.id])
			var gdist := absi(int(goal.c) - int(e.c)) + absi(int(goal.r) - int(e.r))
			var grank := int(ALLY_RANK[goal.id])
			if dist < best or (dist == gdist and rank < grank):
				best = dist
				goal = a
		var cur := absi(int(goal.c) - int(e.c)) + absi(int(goal.r) - int(e.r))
		var steps: Array = []
		for delta in [[0, -1], [-1, 0], [1, 0], [0, 1]]:
			var nc := int(e.c) + int(delta[0])
			var nr := int(e.r) + int(delta[1])
			if nc < 0 or nr < 0 or nc >= COLS or nr >= ROWS or _at(nc, nr) != null:
				continue
			steps.append([nc, nr])
		steps.sort_custom(func(a, b):
			var da := absi(int(goal.c) - int(a[0])) + absi(int(goal.r) - int(a[1]))
			var db := absi(int(goal.c) - int(b[0])) + absi(int(goal.r) - int(b[1]))
			if da != db:
				return da < db
			if int(a[1]) != int(b[1]):
				return int(a[1]) < int(b[1])
			return int(a[0]) < int(b[0])
		)
		if not steps.is_empty():
			var nd := absi(int(goal.c) - int(steps[0][0])) + absi(int(goal.r) - int(steps[0][1]))
			if nd < cur:
				e.c = int(steps[0][0])
				e.r = int(steps[0][1])

func _end_turn() -> void:
	if phase != "playing":
		return
	_enemy_phase()
	if phase != "playing":
		return
	if turn >= LIMIT:
		phase = "fail"
	else:
		turn += 1
		selected = ""
		for u in _living("ally"):
			u.acted = false

func _maybe_auto() -> void:
	if phase != "playing":
		return
	for u in _living("ally"):
		if not bool(u.acted):
			return
	_end_turn()

func _begin() -> void:
	if phase != "ready":
		return
	phase = "playing"
	turn = 1

func _click_cell(c: int, r: int) -> void:
	if phase != "playing":
		return
	var hit = _at(c, r)
	var sel = _by_id(selected) if selected != "" else null
	var can_heal: bool = sel != null and int(sel.hp) > 0 and not bool(sel.acted) and int(sel.heal) > 0 and hit != null and hit.side == "ally" and hit.id != sel.id and absi(int(hit.c) - int(sel.c)) + absi(int(hit.r) - int(sel.r)) == 1
	if can_heal:
		hit.hp = mini(int(hit.max), int(hit.hp) + int(sel.heal))
		sel.acted = true
		selected = ""
		_maybe_auto()
		return
	if hit != null and hit.side == "ally" and not bool(hit.acted):
		selected = hit.id
		return
	if sel == null or bool(sel.acted) or int(sel.hp) <= 0:
		return
	if hit != null and hit.side == "enemy":
		var d = _los(sel, int(hit.c), int(hit.r))
		if d != null and int(d) <= int(sel.rng) and int(sel.atk) > 0:
			hit.hp = maxi(0, int(hit.hp) - int(sel.atk))
			sel.acted = true
			selected = ""
			_settle()
			_maybe_auto()
		return
	if hit == null:
		var ok := false
		for pos in _reach(sel):
			if int(pos[0]) == c and int(pos[1]) == r:
				ok = true
		if not ok:
			return
		sel.c = c
		sel.r = r
		sel.acted = true
		selected = ""
		_settle()
		_maybe_auto()

func _input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		var p: Vector2 = event.position
		if phase == "clear" or phase == "fail":
			return
		if p.x >= 440 and p.x < 840 and p.y >= 620 and p.y < 690:
			_begin()
		elif phase == "playing" and p.x >= 60 and p.x < 300 and p.y >= 620 and p.y < 690:
			_end_turn()
		elif phase == "playing" and p.x >= OX and p.y >= OY:
			var c := int((p.x - OX) / float(CELL))
			var r := int((p.y - OY) / float(CELL))
			if c >= 0 and r >= 0 and c < COLS and r < ROWS:
				_click_cell(c, r)
		_refresh()
		queue_redraw()
	if event is InputEventKey and event.pressed and not event.echo:
		var code := _code(event.keycode)
		if phase == "clear" or phase == "fail":
			return
		if code == "Enter":
			_begin()
		elif code == "Space":
			_end_turn()
		_refresh()
		queue_redraw()

func _code(key: Key) -> String:
	match key:
		KEY_ENTER, KEY_KP_ENTER:
			return "Enter"
		KEY_SPACE:
			return "Space"
		_:
			return ""

func _refresh() -> void:
	if _labels.size() < 5:
		return
	var bits: PackedStringArray = []
	for u in units:
		bits.append("%s %d" % [u.id, int(u.hp)])
	_labels[1].text = "turn %d / 8    %s" % [turn, "   ".join(bits)]
	if phase == "fail":
		_labels[2].text = "Depot lost"
	elif phase == "clear":
		_labels[2].text = "Depot clear"
	else:
		_labels[2].text = ""

func _draw() -> void:
	draw_rect(Rect2(0, 0, 1280, 720), Color("1c1610"))
	draw_rect(Rect2(60, 620, 240, 70), Color("5c4030"))
	draw_rect(Rect2(440, 620, 400, 70), Color("8a5a2a"))
	var floor_tex := _texture("floor.png")
	var depot_tex := _texture("depot.png")
	for r in ROWS:
		for c in COLS:
			var rect := Rect2(OX + c * CELL, OY + r * CELL, CELL, CELL)
			var tile := depot_tex if c == 3 and r == 0 else floor_tex
			if tile:
				draw_texture_rect(tile, rect, false)
			else:
				draw_rect(rect, Color("3a4550"))
	for u in units:
		if int(u.hp) <= 0:
			continue
		var rect := Rect2(OX + int(u.c) * CELL, OY + int(u.r) * CELL, CELL, CELL)
		if u.id == selected:
			draw_rect(rect, Color(0.95, 0.76, 0.2, 0.45))
		var tex := _texture(String(SPRITE[u.id]))
		if tex:
			draw_texture_rect(tex, Rect2(rect.position.x + 8, rect.position.y + 4, 48, 48), false)
