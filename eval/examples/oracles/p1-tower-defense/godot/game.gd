extends Node2D

const COLS := 8
const ROWS := 5
const OX := 352
const OY := 148
const CELL := 72
const COSTS := {"gun": 2, "wall": 2, "cannon": 4}
const RANGE := {"gun": 2, "cannon": 3}
const DMG := {"gun": 1, "cannon": 3}
const TOWER_SPRITE := {"gun": "gun.png", "wall": "wall.png", "cannon": "cannon.png"}
const ENEMY_SPRITE := {"scout": "scout.png", "brute": "brute.png", "flyer": "flyer.png"}

var phase := "ready"
var wave := 0
var dp := 6
var base := 4
var selected := ""
var towers: Array = []
var enemies: Array = []
var queue: Array = []
var _labels: Array[Label] = []
var _tex: Dictionary = {}

func _ready() -> void:
	queue = _opening()
	_label("Tower Defense", 80, 12, 1120, 52, 42)
	_label("", 40, 68, 1200, 36, 28)
	_label("", 80, 548, 1120, 56, 40)
	_label("Step", 60, 634, 240, 42, 32)
	_label("Start", 440, 634, 400, 42, 32)
	_label("gun  2", 48, 172, 260, 32, 24)
	_label("wall  2", 48, 240, 260, 32, 24)
	_label("cannon  4", 48, 308, 260, 32, 24)
	_refresh()
	queue_redraw()

func _opening() -> Array:
	return [
		{"id": 0, "kind": "scout", "hp": 2, "atk": 1, "fly": false, "wave": 1, "c": 0, "r": 2},
		{"id": 1, "kind": "scout", "hp": 2, "atk": 1, "fly": false, "wave": 1, "c": 0, "r": 2},
		{"id": 2, "kind": "flyer", "hp": 3, "atk": 0, "fly": true, "wave": 2, "c": 0, "r": 2},
		{"id": 3, "kind": "brute", "hp": 6, "atk": 2, "fly": false, "wave": 3, "c": 0, "r": 2},
		{"id": 4, "kind": "scout", "hp": 2, "atk": 1, "fly": false, "wave": 3, "c": 0, "r": 2},
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

func _deploy(c: int, r: int) -> bool:
	return (r == 1 or r == 3) and c >= 1 and c <= 6

func _on_path(c: int, r: int) -> bool:
	return r == 2 and c >= 0 and c < COLS

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

func _begin() -> void:
	if phase != "ready":
		return
	phase = "playing"
	wave = 1

func _select(kind: String) -> void:
	if phase != "playing" or not COSTS.has(kind):
		return
	selected = kind

func _place(c: int, r: int) -> void:
	if phase != "playing" or selected == "":
		return
	var kind := selected
	var cost := int(COSTS[kind])
	if dp < cost:
		return
	if kind == "wall":
		if not _on_path(c, r) or _tower_at(c, r) != null or _ground_on(c, r) != null:
			return
		towers.append({"kind": kind, "c": c, "r": r, "hp": 6})
	else:
		if not _deploy(c, r) or _tower_at(c, r) != null:
			return
		towers.append({"kind": kind, "c": c, "r": r, "hp": 1})
	dp -= cost
	selected = ""

func _step() -> void:
	if phase != "playing":
		return
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
			hits[0].hp = int(hits[0].hp) - int(DMG[t.kind])
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
		var blocked: bool = _enemy_on(0, 2, true) != null if bool(next.fly) else (_ground_on(0, 2) != null or _tower_at(0, 2) != null)
		if not blocked:
			queue.pop_front()
			next.c = 0
			next.r = 2
			enemies.append(next)
	if base <= 0:
		phase = "fail"
	elif queue.is_empty() and enemies.is_empty():
		phase = "clear"
	else:
		dp = mini(10, dp + 1)
	wave = _wave_of()

func _ended() -> bool:
	return phase == "clear" or phase == "fail"

func _input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		if _ended():
			return
		var p: Vector2 = event.position
		if p.x >= 440 and p.x < 840 and p.y >= 620 and p.y < 690:
			_begin()
		elif p.x >= 60 and p.x < 300 and p.y >= 620 and p.y < 690:
			_step()
		elif p.x >= 48 and p.x < 308 and p.y >= 160 and p.y < 216:
			_select("gun")
		elif p.x >= 48 and p.x < 308 and p.y >= 228 and p.y < 284:
			_select("wall")
		elif p.x >= 48 and p.x < 308 and p.y >= 296 and p.y < 352:
			_select("cannon")
		elif p.x >= OX and p.y >= OY:
			var c := int((p.x - OX) / float(CELL))
			var r := int((p.y - OY) / float(CELL))
			if c >= 0 and r >= 0 and c < COLS and r < ROWS:
				_place(c, r)
		_refresh()
		queue_redraw()
	if event is InputEventKey and event.pressed and not event.echo:
		if _ended():
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
	if _labels.size() < 3:
		return
	_labels[1].text = "wave %d / 3    dp %d    base %d" % [wave, dp, base]
	if phase == "fail":
		_labels[2].text = "Tower lost"
	elif phase == "clear":
		_labels[2].text = "Tower clear"
	else:
		_labels[2].text = ""

func _draw() -> void:
	draw_rect(Rect2(0, 0, 1280, 720), Color("1c1610"))
	draw_rect(Rect2(60, 620, 240, 70), Color("5c4030"))
	draw_rect(Rect2(440, 620, 400, 70), Color("8a5a2a"))
	var card_y := [160, 228, 296]
	var card_kind := ["gun", "wall", "cannon"]
	for i in card_kind.size():
		var col := Color("c47a2c") if selected == card_kind[i] else Color("5c4030")
		draw_rect(Rect2(48, card_y[i], 260, 56), col)
	var path_tex := _texture("path.png")
	var grass_tex := _texture("grass.png")
	var base_tex := _texture("base.png")
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
		draw_texture_rect(base_tex, Rect2(OX + COLS * CELL, OY + 2 * CELL, CELL, CELL), false)
	var font := ThemeDB.fallback_font
	for t in towers:
		var rect := Rect2(OX + int(t.c) * CELL, OY + int(t.r) * CELL, CELL, CELL)
		var tex := _texture(String(TOWER_SPRITE[t.kind]))
		if tex:
			draw_texture_rect(tex, Rect2(rect.position.x + 12, rect.position.y + 20, 48, 48), false)
		var caption := str(int(t.hp)) if t.kind == "wall" else String(t.kind)
		draw_string(font, rect.position + Vector2(8, 14), caption, HORIZONTAL_ALIGNMENT_LEFT, -1, 14, Color("f6e7c1"))
	for e in enemies:
		var ox := 28 if bool(e.fly) else 4
		var rect := Rect2(OX + int(e.c) * CELL + ox, OY + int(e.r) * CELL + 4, 36, 36)
		var tex := _texture(String(ENEMY_SPRITE[e.kind]))
		if tex:
			draw_texture_rect(tex, rect, false)
		draw_string(font, rect.position + Vector2(0, 48), "%s %d" % [e.kind, int(e.hp)], HORIZONTAL_ALIGNMENT_LEFT, -1, 12, Color("ffe08a"))
