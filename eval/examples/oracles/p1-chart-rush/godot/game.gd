extends Node2D

var phase: String = "ready"
var remainMs: int = 0
var clockMs: int = 0
var hits: int = 0
var misses: int = 0
var cursor: int = 0

const LANES := ["ArrowLeft", "ArrowDown", "ArrowUp", "ArrowRight"]
const WINDOW := 132

func _notes() -> Array:
	var out: Array = []
	for i in 16:
		out.append({"lane": i % 4, "t": 400 * (i + 1)})
	return out

func _start() -> void:
	if phase != "ready":
		return
	phase = "countdown"
	remainMs = 3000

func _process(dt: float) -> void:
	var step := int(round(dt * 1000.0))
	if step <= 0:
		queue_redraw()
		return
	if phase == "countdown":
		remainMs = maxi(0, remainMs - step)
		if remainMs <= 0:
			remainMs = 0
			phase = "playing"
			clockMs = 0
	elif phase == "playing":
		clockMs += step
		var notes := _notes()
		while cursor < notes.size() and clockMs > int(notes[cursor]["t"]) + WINDOW:
			misses += 1
			cursor += 1
		if misses >= 6:
			phase = "fail"
		elif cursor >= notes.size():
			phase = "clear" if hits >= 12 else "fail"
	queue_redraw()

func _input(event) -> void:
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		var p = event.position
		if p.x >= 440 and p.x < 840 and p.y >= 200 and p.y < 320:
			_start()
	if event is InputEventKey and event.pressed and not event.echo:
		if event.keycode == KEY_ENTER:
			_start()
		if phase != "playing":
			return
		var lane := -1
		match event.keycode:
			KEY_LEFT:
				lane = 0
			KEY_DOWN:
				lane = 1
			KEY_UP:
				lane = 2
			KEY_RIGHT:
				lane = 3
		if lane < 0:
			return
		var notes := _notes()
		if cursor >= notes.size():
			return
		var n: Dictionary = notes[cursor]
		if lane == int(n["lane"]) and absi(clockMs - int(n["t"])) <= WINDOW:
			hits += 1
			cursor += 1
			if cursor >= notes.size():
				phase = "clear" if hits >= 12 else "fail"
		else:
			misses += 1
			if misses >= 6:
				phase = "fail"
	queue_redraw()

func _draw() -> void:
	draw_rect(Rect2(0, 0, 1280, 720), Color("1e1b4b"))
	draw_string(ThemeDB.fallback_font, Vector2(40, 52), "Chart Rush", HORIZONTAL_ALIGNMENT_LEFT, 1200, 40, Color("ede9fe"))
	var hud := "phase=%s remainMs=%s clockMs=%s hits=%s misses=%s note=%s" % [phase, remainMs, clockMs, hits, misses, cursor]
	draw_string(ThemeDB.fallback_font, Vector2(40, 100), hud, HORIZONTAL_ALIGNMENT_LEFT, 1200, 22, Color("ddd6fe"))
	var labels := ["Left", "Down", "Up", "Right"]
	for i in 4:
		draw_rect(Rect2(80 + i * 300, 560, 240, 120), Color("312e81"))
		draw_string(ThemeDB.fallback_font, Vector2(80 + i * 300, 624), labels[i], HORIZONTAL_ALIGNMENT_CENTER, 240, 28, Color("c4b5fd"))
	if phase == "playing":
		var notes := _notes()
		var cols := [Color("fb7185"), Color("38bdf8"), Color("a3e635"), Color("fbbf24")]
		for i in range(cursor, notes.size()):
			var n: Dictionary = notes[i]
			var y := 520.0 - maxf(0.0, float(int(n["t"]) - clockMs) * 0.12)
			if y < 140:
				continue
			draw_rect(Rect2(80 + int(n["lane"]) * 300 + 40, y, 160, 36), cols[int(n["lane"])])
	if phase == "ready":
		draw_rect(Rect2(440, 200, 400, 120), Color("5b21b6"))
		draw_string(ThemeDB.fallback_font, Vector2(440, 272), "Start", HORIZONTAL_ALIGNMENT_CENTER, 400, 48, Color("f5f3ff"))
	if phase == "fail":
		draw_string(ThemeDB.fallback_font, Vector2(40, 200), "Chart miss", HORIZONTAL_ALIGNMENT_CENTER, 1200, 44, Color("fecaca"))
	if phase == "clear":
		draw_string(ThemeDB.fallback_font, Vector2(40, 200), "Chart clear", HORIZONTAL_ALIGNMENT_CENTER, 1200, 44, Color("bbf7d0"))
