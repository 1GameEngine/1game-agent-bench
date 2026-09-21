extends Node2D
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
