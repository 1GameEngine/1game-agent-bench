extends Node2D

const COLS := 8
const ROWS := 5
const OX := 352
const OY := 148
const CELL := 72
const COSTS := {"gun": 2, "wall": 2, "cannon": 4}
const RANGE := {"gun": 2, "cannon": 3}
const TOWER_SPRITE := {"gun": "gun.png", "wall": "wall.png", "cannon": "cannon.png"}
const ENEMY_SPRITE := {"scout": "scout.png", "brute": "brute.png", "flyer": "flyer.png"}

var screen := "select"
var map_id := ""
var open := 1
var slot := 1
var phase := "ready"
var wave := 0
var dp := 6
var base := 4
var selected := ""
var picked = null
var note := ""
var shots: Array = []
var towers: Array = []
var enemies: Array = []
var queue: Array = []
var drag = null
var anim := 0
var clock := 0
var _labels: Array[Label] = []
var _tex: Dictionary = {}

func _ready() -> void:
	set_process(false)
	queue = _opening()
	_label("Tower Defense", 80, 12, 1120, 52, 42)
	_label("", 40, 68, 1200, 36, 28)
	_label("", 80, 548, 1120, 56, 40)
	_label("Straight", 80, 200, 520, 40, 36)
	_label("Open", 80, 252, 520, 32, 28)
	_label("Bend", 640, 200, 520, 40, 36)
	_label("Locked", 640, 252, 520, 32, 28)
	_label("Save", 80, 432, 200, 32, 24)
	_label("Wipe", 300, 432, 200, 32, 24)
	_label("Load", 520, 432, 200, 32, 24)
	_label("gun  2", 48, 172, 260, 32, 24)
	_label("wall  2", 48, 240, 260, 32, 24)
	_label("cannon  4", 48, 308, 260, 32, 24)
	_label("Upgrade  2", 1020, 172, 220, 32, 24)
	_label("Maps", 1020, 412, 220, 32, 24)
	_label("Step", 60, 634, 240, 42, 32)
	_label("Start", 440, 634, 400, 42, 32)
	_label("Retry", 900, 634, 280, 42, 32)
	_refresh()
	queue_redraw()

func _opening() -> Array:
	return [
		{"id": 0, "kind": "scout", "hp": 2, "atk": 1, "fly": false, "wave": 1},
		{"id": 1, "kind": "scout", "hp": 2, "atk": 1, "fly": false, "wave": 1},
		{"id": 2, "kind": "flyer", "hp": 3, "atk": 0, "fly": true, "wave": 2},
		{"id": 3, "kind": "brute", "hp": 6, "atk": 2, "fly": false, "wave": 3},
		{"id": 4, "kind": "scout", "hp": 2, "atk": 1, "fly": false, "wave": 3},
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

func _path_row() -> int:
	return 4 if map_id == "bend" else 2

func _deploy(c: int, r: int) -> bool:
	if map_id == "bend":
		return r == 2 and c >= 1 and c <= 6
	return (r == 1 or r == 3) and c >= 1 and c <= 6

func _on_path(c: int, r: int) -> bool:
	return r == _path_row() and c >= 0 and c < COLS

func _tower_at(c: int, r: int):
	for t in towers:
		if int(t.c) == c and int(t.r) == r:
			return t
	return null

func _enemy_on(c: int, r: int, fly: bool):
	for e in enemies:
		if int(e.c) == c and int(e.r) == r and bool(e.fly) == fly:
			return e
	return null

func _ground_on(c: int, r: int):
	return _enemy_on(c, r, false)

func _wave_of() -> int:
	var best := 99
	var any := false
	for e in queue:
		any = true
		best = mini(best, int(e.wave))
	for e in enemies:
		any = true
		best = mini(best, int(e.wave))
	if not any:
		return 0 if phase == "ready" else 3
	return best

func _clear_note() -> void:
	if note == "Rejected":
		note = ""

func _reject() -> void:
	note = "Rejected"

func _dmg_of(t) -> int:
	if String(t.kind) == "gun":
		return 2 if bool(t.upgraded) else 1
	if String(t.kind) == "cannon":
		return 5 if bool(t.upgraded) else 3
	return 0

func _reset_battle() -> void:
	phase = "ready"
	wave = 0
	dp = 6
	base = 4
	selected = ""
	picked = null
	note = ""
	shots = []
	towers = []
	enemies = []
	queue = _opening()
	drag = null
	clock = 0

func _enter(which: String) -> void:
	if screen != "select":
		return
	if which == "bend" and open < 2:
		_reject()
		return
	if which != "straight" and which != "bend":
		return
	screen = "battle"
	map_id = which
	_reset_battle()

func _begin() -> void:
	if screen != "battle" or phase != "ready":
		return
	phase = "playing"
	wave = 1

func _place(c: int, r: int) -> void:
	if screen != "battle" or phase != "playing":
		return
	if selected == "":
		var existing = _tower_at(c, r)
		if existing != null:
			picked = {"c": c, "r": r}
		return
	var kind := selected
	var cost := int(COSTS[kind])
	if dp < cost:
		_reject()
		return
	if kind == "wall":
		if not _on_path(c, r) or _tower_at(c, r) != null or _ground_on(c, r) != null:
			_reject()
			return
		towers.append({"kind": kind, "c": c, "r": r, "hp": 6, "upgraded": false})
	else:
		if not _deploy(c, r) or _tower_at(c, r) != null:
			_reject()
			return
		towers.append({"kind": kind, "c": c, "r": r, "hp": 1, "upgraded": false})
	dp -= cost
	selected = ""
	picked = null
	_clear_note()

func _upgrade() -> void:
	if screen != "battle" or phase != "playing":
		return
	var t = null
	if picked != null:
		t = _tower_at(int(picked.c), int(picked.r))
	if t == null or bool(t.upgraded) or dp < 2:
		_reject()
		return
	dp -= 2
	t.upgraded = true
	if String(t.kind) == "wall":
		t.hp = int(t.hp) + 4
	picked = null
	_clear_note()

func _retry() -> void:
	if screen != "battle":
		return
	if phase != "clear" and phase != "fail":
		return
	var kept_map := map_id
	var kept_open := open
	var kept_slot := slot
	_reset_battle()
	screen = "battle"
	map_id = kept_map
	open = kept_open
	slot = kept_slot

func _maps() -> void:
	if screen != "battle":
		return
	if phase != "clear" and phase != "fail":
		return
	screen = "select"
	drag = null
	note = ""
	shots = []
	phase = "ready"

func _save_game() -> void:
	if screen != "select":
		return
	slot = open
	note = "Saved"

func _wipe() -> void:
	if screen != "select":
		return
	open = 1
	note = "Wiped"

func _load_game() -> void:
	if screen != "select":
		return
	open = slot
	note = "Loaded"

func _step() -> void:
	if screen != "battle" or phase != "playing":
		return
	_clear_note()
	shots = []
	var row := _path_row()
	var shooters: Array = []
	for t in towers:
		if t.kind != "wall":
			shooters.append(t)
	shooters.sort_custom(func(a, b): return int(a.c) < int(b.c) or (int(a.c) == int(b.c) and int(a.r) < int(b.r)))
	for t in shooters:
		var hits: Array = []
		for e in enemies:
			if absi(int(e.c) - int(t.c)) + absi(int(e.r) - int(t.r)) <= int(RANGE[t.kind]):
				hits.append(e)
		hits.sort_custom(func(a, b):
			if int(a.c) != int(b.c):
				return int(a.c) > int(b.c)
			if int(a.r) != int(b.r):
				return int(a.r) < int(b.r)
			return (0 if bool(a.fly) else 1) > (0 if bool(b.fly) else 1)
		)
		if hits.size() > 0:
			hits[0].hp = int(hits[0].hp) - _dmg_of(t)
			shots.append({"fc": int(t.c), "fr": int(t.r), "tc": int(hits[0].c), "tr": int(hits[0].r)})
	var alive: Array = []
	for e in enemies:
		if int(e.hp) > 0:
			alive.append(e)
	enemies = alive
	var order: Array = enemies.duplicate()
	order.sort_custom(func(a, b):
		if int(a.c) != int(b.c):
			return int(a.c) > int(b.c)
		if int(a.r) != int(b.r):
			return int(a.r) < int(b.r)
		return (0 if bool(a.fly) else 1) > (0 if bool(b.fly) else 1)
	)
	for e in order:
		if not enemies.has(e):
			continue
		var nc := int(e.c) + 1
		if nc >= COLS:
			base -= 1
			enemies.erase(e)
			continue
		if bool(e.fly):
			if _enemy_on(nc, int(e.r), true) != null:
				continue
			e.c = nc
			continue
		var wall = _tower_at(nc, int(e.r))
		if wall != null and wall.kind == "wall":
			wall.hp = int(wall.hp) - int(e.atk)
			continue
		if _ground_on(nc, int(e.r)) != null:
			continue
		e.c = nc
	var standing: Array = []
	for t in towers:
		if t.kind != "wall" or int(t.hp) > 0:
			standing.append(t)
	towers = standing
	if queue.size() > 0:
		var next = queue[0]
		var blocked: bool = _enemy_on(0, row, true) != null if bool(next.fly) else (_ground_on(0, row) != null or _tower_at(0, row) != null)
		if not blocked:
			queue.pop_front()
			next.c = 0
			next.r = row
			enemies.append(next)
	if base <= 0:
		phase = "fail"
	elif queue.is_empty() and enemies.is_empty():
		phase = "clear"
		if map_id == "straight":
			open = maxi(open, 2)
	wave = _wave_of()

func _process(_delta: float) -> void:
	anim += 1
	if screen == "battle" and phase == "playing":
		clock += 1
		if clock % 30 == 0:
			dp = mini(10, dp + 1)
	_refresh()
	queue_redraw()

func _inside(p: Vector2, x: float, y: float, w: float, h: float) -> bool:
	return p.x >= x and p.x < x + w and p.y >= y and p.y < y + h

func _card_at(p: Vector2) -> String:
	if _inside(p, 48, 160, 260, 56):
		return "gun"
	if _inside(p, 48, 228, 260, 56):
		return "wall"
	if _inside(p, 48, 296, 260, 56):
		return "cannon"
	return ""

func _click(p: Vector2) -> void:
	if screen == "battle" and _inside(p, 900, 620, 280, 70):
		_retry()
		return
	if screen == "battle" and _inside(p, 1020, 400, 220, 56):
		_maps()
		return
	if phase == "clear" or phase == "fail":
		return
	if screen == "battle" and _inside(p, 1020, 160, 220, 56):
		_upgrade()
		return
	if screen == "battle" and _inside(p, 440, 620, 400, 70):
		_begin()
		return
	if screen == "battle" and _inside(p, 60, 620, 240, 70):
		_step()
		return
	if screen == "select" and _inside(p, 80, 160, 520, 180):
		_enter("straight")
		return
	if screen == "select" and _inside(p, 640, 160, 520, 180):
		_enter("bend")
		return
	if screen == "select" and _inside(p, 80, 420, 200, 56):
		_save_game()
		return
	if screen == "select" and _inside(p, 300, 420, 200, 56):
		_wipe()
		return
	if screen == "select" and _inside(p, 520, 420, 200, 56):
		_load_game()
		return
	if screen == "battle" and phase == "playing" and p.x >= OX and p.y >= OY:
		var c := int((p.x - OX) / float(CELL))
		var r := int((p.y - OY) / float(CELL))
		if c >= 0 and r >= 0 and c < COLS and r < ROWS:
			var tower = _tower_at(c, r)
			if tower != null:
				picked = {"c": c, "r": r}

func _pointer_down(p: Vector2) -> void:
	if screen == "battle" and phase == "playing":
		var kind := _card_at(p)
		if kind != "":
			drag = {"kind": kind, "x": p.x, "y": p.y}
			picked = null

func _pointer_move(p: Vector2) -> void:
	if drag == null:
		return
	drag = {"kind": String(drag.kind), "x": p.x, "y": p.y}

func _pointer_up(p: Vector2) -> void:
	if drag == null:
		_click(p)
		return
	var kind := String(drag.kind)
	drag = null
	if phase != "playing":
		return
	selected = kind
	if p.x >= OX and p.y >= OY:
		var c := int((p.x - OX) / float(CELL))
		var r := int((p.y - OY) / float(CELL))
		if c >= 0 and r >= 0 and c < COLS and r < ROWS:
			_place(c, r)
			selected = ""
			return
	_reject()
	selected = ""

func _input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT:
		var p: Vector2 = event.position
		if event.pressed:
			_pointer_down(p)
		else:
			_pointer_up(p)
		_refresh()
		queue_redraw()
	elif event is InputEventMouseMotion:
		_pointer_move(event.position)
		_refresh()
		queue_redraw()
	elif event is InputEventKey and event.pressed and not event.echo:
		if screen != "battle" or phase == "clear" or phase == "fail":
			return
		var code := _code(event.keycode)
		if code == "Enter":
			_begin()
		elif code == "Space":
			_step()
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
	if _labels.size() < 18:
		return
	var on_select := screen == "select"
	if on_select:
		_labels[1].text = "open %d / 2" % open
	else:
		_labels[1].text = "wave %d / 3    dp %d    base %d" % [wave, dp, base]
	if screen == "battle" and phase == "fail":
		_labels[2].text = "Tower lost"
	elif screen == "battle" and phase == "clear":
		_labels[2].text = "Tower clear"
	else:
		_labels[2].text = note
	_labels[6].text = "Open" if open >= 2 else "Locked"
	for i in range(3, 10):
		_labels[i].visible = on_select
	for i in range(10, 18):
		_labels[i].visible = not on_select

func _draw() -> void:
	draw_rect(Rect2(0, 0, 1280, 720), Color("1c1610"))
	if screen == "select":
		draw_rect(Rect2(80, 160, 520, 180), Color("8a5a2a"))
		draw_rect(Rect2(640, 160, 520, 180), Color("8a5a2a") if open >= 2 else Color("3a3128"))
		draw_rect(Rect2(80, 420, 200, 56), Color("3d4a38"))
		draw_rect(Rect2(300, 420, 200, 56), Color("5c4030"))
		draw_rect(Rect2(520, 420, 200, 56), Color("3d4a38"))
		return
	draw_rect(Rect2(60, 620, 240, 70), Color("5c4030"))
	draw_rect(Rect2(440, 620, 400, 70), Color("8a5a2a"))
	draw_rect(Rect2(900, 620, 280, 70), Color("3d4a38"))
	draw_rect(Rect2(1020, 160, 220, 56), Color("5c4030"))
	draw_rect(Rect2(1020, 400, 220, 56), Color("3d4a38"))
	var card_y := [160, 228, 296]
	var card_kind := ["gun", "wall", "cannon"]
	for i in card_kind.size():
		draw_rect(Rect2(48, card_y[i], 260, 56), Color("5c4030"))
	var path_tex := _texture("path.png")
	var grass_tex := _texture("grass.png")
	var base_tex := _texture("base.png")
	var row := _path_row()
	for r in ROWS:
		for c in COLS:
			var rect := Rect2(OX + c * CELL, OY + r * CELL, CELL, CELL)
			var tex: Texture2D = null
			if _on_path(c, r):
				tex = path_tex
			elif _deploy(c, r):
				tex = grass_tex
			if tex:
				draw_texture_rect(tex, rect, false)
			else:
				draw_rect(rect, Color("241c16"))
	if base_tex:
		draw_texture_rect(base_tex, Rect2(OX + COLS * CELL, OY + row * CELL, CELL, CELL), false)
	var font := ThemeDB.fallback_font
	for t in towers:
		var cell := Rect2(OX + int(t.c) * CELL, OY + int(t.r) * CELL, CELL, CELL)
		var tex := _texture(String(TOWER_SPRITE[t.kind]))
		if tex:
			draw_texture_rect(tex, Rect2(cell.position.x + 12, cell.position.y + 20, 48, 48), false)
		var plus := "+" if bool(t.upgraded) else ""
		var caption := (str(int(t.hp)) if t.kind == "wall" else String(t.kind)) + plus
		draw_string(font, cell.position + Vector2(8, 14), caption, HORIZONTAL_ALIGNMENT_LEFT, -1, 14, Color("f6e7c1"))
	var bob := 0 if anim % 10 < 5 else 8
	for e in enemies:
		var ox := 28 if bool(e.fly) else 4
		var rect := Rect2(OX + int(e.c) * CELL + ox, OY + int(e.r) * CELL + 4 + bob, 36, 36)
		var tex := _texture(String(ENEMY_SPRITE[e.kind]))
		if tex:
			draw_texture_rect(tex, rect, false)
		draw_string(font, rect.position + Vector2(0, 48), "%s %d" % [e.kind, int(e.hp)], HORIZONTAL_ALIGNMENT_LEFT, -1, 12, Color("ffe08a"))
	for shot in shots:
		var x1 := OX + int(shot.fc) * CELL + CELL / 2.0
		var y1 := OY + int(shot.fr) * CELL + CELL / 2.0
		var x2 := OX + int(shot.tc) * CELL + CELL / 2.0
		var y2 := OY + int(shot.tr) * CELL + CELL / 2.0
		draw_line(Vector2(x1, y1), Vector2(x2, y2), Color("ffe14a"), 4.0)
		var along := float(anim % 7) / 6.0
		var dx := x1 + (x2 - x1) * along
		var dy := y1 + (y2 - y1) * along
		draw_rect(Rect2(dx - 6, dy - 6, 12, 12), Color("ffe14a"))
	if drag != null:
		var ghost := _texture(String(TOWER_SPRITE[String(drag.kind)]))
		if ghost:
			draw_texture_rect(ghost, Rect2(float(drag.x) - 24, float(drag.y) - 24, 48, 48), false)
