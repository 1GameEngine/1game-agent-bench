extends Node2D

const LANES := ["ArrowLeft", "ArrowDown", "ArrowUp", "ArrowRight"]
const ARROWS := ["arrow-left.png", "arrow-down.png", "arrow-up.png", "arrow-right.png"]
const NOTE_COUNT := 16
const STEP_MS := 400
const WINDOW_MS := 132
const COUNTDOWN_MS := 3000
const TRAVEL_MS := 800
const JUDGE_Y := 560.0

var phase := "ready"
var countdown_ms := COUNTDOWN_MS
var play_ms := 0
var hits := 0
var misses := 0
var next_note := 0
var _labels: Array[Label] = []

func _ready() -> void:
	var bg := ColorRect.new()
	bg.position = Vector2.ZERO
	bg.size = Vector2(1280, 720)
	bg.color = Color("12081c")
	bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(bg)
	_label("Chart Rush", 80, 36, 1120, 72, 64)
	_label("Start", 440, 150, 400, 100, 56)
	_label("", 80, 270, 1120, 64, 42)
	_label("", 80, 620, 1120, 64, 36)
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

func _label(text: String, x: float, y: float, w: float, h: float, size: int) -> void:
	var lab := Label.new()
	lab.position = Vector2(x, y)
	lab.size = Vector2(w, h)
	lab.text = text
	lab.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	lab.add_theme_font_size_override("font_size", size)
	lab.add_theme_color_override("font_color", Color("f8e7ff"))
	add_child(lab)
	_labels.append(lab)

func _texture(name: String) -> Texture2D:
	var path := "res://assets/%s" % name
	if ResourceLoader.exists(path):
		return load(path)
	return null

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
		_expire()
		if phase == "playing" and next_note >= NOTE_COUNT:
			phase = "clear" if hits >= 12 else "fail"
	_refresh()
	queue_redraw()

func _expire() -> void:
	while next_note < NOTE_COUNT and play_ms > STEP_MS * (next_note + 1) + WINDOW_MS:
		misses += 1
		next_note += 1
		if misses >= 6:
			phase = "fail"
			return

func _input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		var p: Vector2 = event.position
		if phase == "ready" and p.x >= 440 and p.x < 840 and p.y >= 140 and p.y < 260:
			phase = "countdown"
	if event is InputEventKey and event.pressed and not event.echo:
		var code := _code(event.keycode)
		if phase == "ready" and (code == "Enter" or code == "Space"):
			phase = "countdown"
		elif phase == "playing":
			_strike(code)

func _strike(code: String) -> void:
	if next_note >= NOTE_COUNT:
		return
	var due := STEP_MS * (next_note + 1)
	var lane: String = str(LANES[next_note % 4])
	if abs(play_ms - due) <= WINDOW_MS and code == lane:
		hits += 1
		next_note += 1
	else:
		misses += 1
	if misses >= 6:
		phase = "fail"
	elif next_note >= NOTE_COUNT:
		phase = "clear" if hits >= 12 else "fail"

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

func _refresh() -> void:
	if _labels.size() < 4:
		return
	_labels[2].text = "3" if phase == "countdown" else ""
	if phase == "countdown":
		_labels[2].text = str(int(ceil(float(countdown_ms) / 1000.0)))
	var banner := ""
	if phase == "fail":
		banner = "Chart miss"
	elif phase == "clear":
		banner = "Chart clear   hits %d" % hits
	elif phase == "playing":
		banner = "hits %d" % hits
	_labels[3].text = banner

func _draw() -> void:
	for i in 4:
		draw_rect(Rect2(160 + i * 220, 340, 120, 260), Color(1, 1, 1, 0.06), false, 2.0)
	if phase != "playing" and phase != "clear" and phase != "fail":
		return
	for i in NOTE_COUNT:
		if i < next_note:
			continue
		var due := STEP_MS * (i + 1)
		var age := play_ms - (due - TRAVEL_MS)
		if age < 0 or age > TRAVEL_MS + 80:
			continue
		var y := 340.0 + (JUDGE_Y - 340.0) * clampf(float(age) / float(TRAVEL_MS), 0.0, 1.1)
		var tex := _texture(ARROWS[i % 4])
		if tex:
			draw_texture_rect(tex, Rect2(176 + (i % 4) * 220, y - 24, 88, 88), false)
		else:
			draw_rect(Rect2(176 + (i % 4) * 220, y - 24, 88, 88), Color("ff4fd8"))
