extends Node2D

var phase: String = "ready"
var score: int = 0
var _hud: Label

func _ready() -> void:
	var bg := ColorRect.new()
	bg.position = Vector2.ZERO
	bg.size = Vector2(320, 180)
	bg.color = Color("0f1224")
	bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(bg)
	_hud = Label.new()
	_hud.position = Vector2(12, 8)
	_hud.size = Vector2(296, 24)
	_hud.add_theme_font_size_override("font_size", 16)
	add_child(_hud)
	_refresh()

func _refresh() -> void:
	_hud.text = "phase=%s score=%s" % [phase, score]

func _input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		if phase == "ready":
			phase = "playing"
		else:
			score += 1
		_refresh()
