extends Node2D

const LANES := ["ArrowLeft", "ArrowDown", "ArrowUp", "ArrowRight"]
const ARROWS := ["arrow-left.png", "arrow-down.png", "arrow-up.png", "arrow-right.png"]
const NOTE_COUNT := 16
const STEP_MS := 400
const WINDOW_MS := 132
const COUNTDOWN_MS := 3000
const TRAVEL_MS := 800
const HOLD_MS := 200
const JUDGE_Y := 560.0
const GRADE_COLOR := {
	"Perfect": "ffe14a",
	"Great": "7dffb3",
	"Good": "8ec5ff",
	"Miss": "ff5a6a",
}

var phase := "ready"
var countdown_ms := COUNTDOWN_MS
var play_ms := 0
var hits := 0
var misses := 0
var next_note := 0
var hp := 100
var combo := 0
var max_combo := 0
var score := 0
var perfects := 0
var greats := 0
var goods := 0
var grade := ""
var grade_ms := 0
var hold_index := -1
var hold_band := ""
var hold_due := 0
var _labels: Array[Label] = []

func _ready() -> void:
	var bg := ColorRect.new()
	bg.position = Vector2.ZERO
	bg.size = Vector2(1280, 720)
	bg.color = Color("12081c")
	bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
	bg.z_index = -1
	add_child(bg)
	_label("Chart Rush", 80, 36, 1120, 72, 64)
	_label("Start", 440, 150, 400, 100, 56)
	_label("", 80, 270, 1120, 64, 42)
	_label("", 40, 600, 1200, 40, 24)
	_label("", 40, 648, 1200, 36, 24)
	for i in 4:
		var tex := _texture(ARROWS[i])
		var cap := Sprite2D.new()
		cap.position = Vector2(220 + i * 220, JUDGE_Y)
		cap.scale = Vector2(4, 4)
		if tex:
			cap.texture = tex
		cap.name = "cap%d" % i
		add_child(cap)
	set_process(true)

func _label(text: String, x: float, y: float, w: float, h: float, size: int) -> Label:
	var lab := Label.new()
	lab.position = Vector2(x, y)
	lab.size = Vector2(w, h)
	lab.text = text
	lab.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	lab.mouse_filter = Control.MOUSE_FILTER_IGNORE
	lab.add_theme_font_size_override("font_size", size)
	lab.add_theme_color_override("font_color", Color("f8e7ff"))
	add_child(lab)
	_labels.append(lab)
	return lab

func _texture(name: String) -> Texture2D:
	var path := "res://assets/%s" % name
	if ResourceLoader.exists(path):
		return load(path)
	return null

func _is_hold(index: int) -> bool:
	return index == 4 or index == 8

func _band(delta: int) -> String:
	if delta <= 40:
		return "Perfect"
	if delta <= 80:
		return "Great"
	if delta <= WINDOW_MS:
		return "Good"
	return "Miss"

func _multiplier(n: int) -> int:
	if n >= 12:
		return 8
	if n >= 8:
		return 4
	if n >= 4:
		return 2
	return 1

func _finish() -> void:
	if hp <= 0:
		phase = "fail"
	elif next_note >= NOTE_COUNT:
		phase = "clear" if hits >= 12 else "fail"

func _award(kind: String, consume: bool) -> void:
	if kind == "Miss":
		misses += 1
		hp = maxi(0, hp - 20)
		combo = 0
	else:
		hits += 1
		combo += 1
		max_combo = maxi(max_combo, combo)
		var pts := 40
		if kind == "Perfect":
			pts = 100
			perfects += 1
			hp = mini(100, hp + 8)
		elif kind == "Great":
			pts = 70
			greats += 1
		else:
			goods += 1
		score += pts * _multiplier(combo)
	grade = kind
	grade_ms = 500
	hold_index = -1
	if consume:
		next_note += 1
	_finish()

func _process(delta: float) -> void:
	var dt := int(round(delta * 1000.0))
	if dt < 1:
		dt = 33
	if phase == "countdown":
		countdown_ms = max(0, countdown_ms - dt)
		if countdown_ms <= 0:
			phase = "playing"
			play_ms = 0
	elif phase == "playing":
		play_ms += dt
		if hold_index >= 0 and play_ms >= hold_due + HOLD_MS:
			_award(hold_band, true)
		if phase == "playing":
			_expire()
	if grade_ms > 0:
		grade_ms = max(0, grade_ms - dt)
	_refresh()
	queue_redraw()

func _expire() -> void:
	while next_note < NOTE_COUNT and hold_index < 0 and play_ms > STEP_MS * (next_note + 1) + WINDOW_MS:
		_award("Miss", true)
		if phase != "playing":
			return

func _input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		var p: Vector2 = event.position
		if phase == "ready" and p.x >= 440 and p.x < 840 and p.y >= 140 and p.y < 260:
			phase = "countdown"
	if event is InputEventKey and not event.echo:
		var code := _code(event.keycode)
		if event.pressed:
			if phase == "ready" and (code == "Enter" or code == "Space"):
				phase = "countdown"
			elif phase == "playing":
				_strike(code)
		elif phase == "playing":
			_release(code)

func _strike(code: String) -> void:
	if hold_index >= 0 or next_note >= NOTE_COUNT:
		return
	var due := STEP_MS * (next_note + 1)
	var lane: String = LANES[next_note % 4]
	var delta := absi(play_ms - due)
	if delta <= WINDOW_MS and code == lane:
		var band := _band(delta)
		if _is_hold(next_note):
			hold_index = next_note
			hold_band = band
			hold_due = due
			return
		_award(band, true)
	else:
		_award("Miss", false)

func _release(code: String) -> void:
	if hold_index < 0:
		return
	if code != LANES[hold_index % 4]:
		return
	if play_ms >= hold_due + HOLD_MS:
		_award(hold_band, true)
	else:
		_award("Miss", true)

func _code(key: Key) -> String:
	match key:
		KEY_LEFT:
			return "ArrowLeft"
		KEY_DOWN:
			return "ArrowDown"
		KEY_UP:
			return "ArrowUp"
		KEY_RIGHT:
			return "ArrowRight"
		KEY_ENTER, KEY_KP_ENTER:
			return "Enter"
		KEY_SPACE:
			return "Space"
		_:
			return ""

func _accuracy() -> int:
	var total := hits + misses
	if total <= 0:
		return 100
	return int(round(100.0 * float(hits) / float(total)))

func _letter(pct: int) -> String:
	if pct >= 95:
		return "S"
	if pct >= 85:
		return "A"
	if pct >= 70:
		return "B"
	if pct >= 50:
		return "C"
	return "F"

func _refresh() -> void:
	if _labels.size() < 5:
		return
	if phase == "countdown":
		_labels[2].text = str(int(ceil(float(countdown_ms) / 1000.0)))
	elif grade_ms > 0:
		_labels[2].text = grade
		_labels[2].add_theme_color_override("font_color", Color(GRADE_COLOR[grade]))
	else:
		_labels[2].text = ""
		_labels[2].add_theme_color_override("font_color", Color("f8e7ff"))
	var banner := ""
	if phase == "fail" or phase == "clear":
		var pct := _accuracy()
		var head := "Chart miss" if phase == "fail" else "Chart clear"
		banner = "%s  hits %d  score %d  combo %d  accuracy %d%%  grade %s" % [head, hits, score, max_combo, pct, _letter(pct)]
		_labels[4].text = "Perfect %d  Great %d  Good %d  Miss %d" % [perfects, greats, goods, misses]
	elif phase == "playing":
		banner = "hits %d  combo %d  x%d" % [hits, combo, _multiplier(combo)]
		_labels[4].text = ""
	else:
		_labels[4].text = ""
	_labels[3].text = banner

func _draw() -> void:
	for i in 4:
		draw_rect(Rect2(160 + i * 220, 340, 120, 260), Color(1, 1, 1, 0.06), false, 2.0)
	if phase == "ready":
		return
	draw_rect(Rect2(440, 118, 400, 22), Color("2a2030"))
	draw_rect(Rect2(440, 118, 400.0 * float(hp) / 100.0, 22), Color("ff5a6a"))
	var marks := ["Perfect", "Great", "Good", "Miss"]
	for i in marks.size():
		var col := Color(GRADE_COLOR[marks[i]])
		var x := 360.0 + float(i) * 150.0
		if marks[i] == "Perfect":
			draw_colored_polygon(PackedVector2Array([Vector2(x + 16, 300), Vector2(x + 32, 316), Vector2(x + 16, 332), Vector2(x, 316)]), col)
		elif marks[i] == "Great":
			draw_circle(Vector2(x + 16, 316), 14, col)
		elif marks[i] == "Good":
			draw_rect(Rect2(x + 4, 304, 24, 24), col)
		else:
			draw_line(Vector2(x + 4, 304), Vector2(x + 28, 328), col, 4.0)
			draw_line(Vector2(x + 28, 304), Vector2(x + 4, 328), col, 4.0)
	if phase != "playing" and phase != "clear" and phase != "fail":
		return
	for i in NOTE_COUNT:
		if i < next_note:
			continue
		if i == hold_index:
			pass
		var due := STEP_MS * (i + 1)
		var age := play_ms - (due - TRAVEL_MS)
		if age < 0 or age > TRAVEL_MS + 80:
			continue
		var y := 340.0 + (JUDGE_Y - 340.0) * clampf(float(age) / float(TRAVEL_MS), 0.0, 1.1)
		var nx := 176.0 + float(i % 4) * 220.0
		if _is_hold(i):
			draw_rect(Rect2(nx + 34, y - 24.0 - 55.0, 20, 55), Color("f8e7ff"))
		var tex := _texture(ARROWS[i % 4])
		if tex:
			draw_texture_rect(tex, Rect2(nx, y - 24, 88, 88), false)
		else:
			draw_rect(Rect2(nx, y - 24, 88, 88), Color("ff4fd8"))
