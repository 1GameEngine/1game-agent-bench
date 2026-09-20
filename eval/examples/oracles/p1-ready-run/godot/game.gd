extends Node2D
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
