extends Node2D

var phase: String = "ready"
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
	var btn := ColorRect.new()
	btn.position = Vector2(110, 70)
	btn.size = Vector2(100, 40)
	btn.color = Color("2563eb")
	btn.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(btn)
	var lab := Label.new()
	lab.position = Vector2(110, 78)
	lab.size = Vector2(100, 24)
	lab.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	lab.text = "Start"
	lab.add_theme_font_size_override("font_size", 18)
	add_child(lab)
	_refresh()

func _refresh() -> void:
	_hud.text = "phase=%s" % phase

func _input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		var p: Vector2 = event.position
		if p.x >= 110 and p.x < 210 and p.y >= 70 and p.y < 110:
			phase = "playing"
			_refresh()
