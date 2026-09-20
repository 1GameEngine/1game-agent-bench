extends Node2D

var phase: String = "countdown"
var remainMs: int = 3000
var _hud: Label

func _ready() -> void:
	set_process(false)
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
	_refresh()

func _refresh() -> void:
	_hud.text = "phase=%s remainMs=%s" % [phase, remainMs]

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
