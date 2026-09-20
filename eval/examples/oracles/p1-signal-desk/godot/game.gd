extends Node2D
var lamp: bool = false
var channel: String = "A"
var armed: bool = false
var shots: int = 0
var _hud: Label
var _btns: Dictionary = {}

func _ready() -> void:
	var bg := ColorRect.new()
	bg.position = Vector2.ZERO
	bg.size = Vector2(1280, 720)
	bg.color = Color("0f1224")
	bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(bg)
	_hud = Label.new()
	_hud.position = Vector2(48, 24)
	_hud.size = Vector2(1184, 80)
	_hud.add_theme_font_size_override("font_size", 40)
	add_child(_hud)
	_add_btn("toggle", 80, 140, 240, 120, "Toggle")
	_add_btn("chanA", 400, 140, 200, 120, "A")
	_add_btn("chanB", 640, 140, 200, 120, "B")
	_add_btn("chanC", 880, 140, 200, 120, "C")
	_add_btn("arm", 200, 400, 360, 160, "Arm")
	_add_btn("fire", 720, 400, 360, 160, "Fire")
	_refresh()

func _add_btn(id: String, x: int, y: int, w: int, h: int, caption: String) -> void:
	var r := ColorRect.new()
	r.position = Vector2(x, y)
	r.size = Vector2(w, h)
	r.color = Color("2563eb")
	r.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(r)
	_btns[id] = r
	var lab := Label.new()
	lab.position = Vector2(x, y + maxi(0, int(h / 2) - 40))
	lab.size = Vector2(w, mini(h, 96))
	lab.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	lab.text = caption
	lab.add_theme_font_size_override("font_size", 48)
	add_child(lab)

func _paint(id: String, on: bool) -> void:
	if _btns.has(id):
		_btns[id].color = Color("fbbf24") if on else Color("2563eb")

func _refresh() -> void:
	_hud.text = "lamp=%s ch=%s armed=%s shots=%s" % [lamp, channel, armed, shots]
	_paint("toggle", lamp)
	_paint("chanA", channel == "A")
	_paint("chanB", channel == "B")
	_paint("chanC", channel == "C")
	_paint("arm", armed)

func _input(event) -> void:
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		var p = event.position
		if p.x >= 80 and p.x < 320 and p.y >= 140 and p.y < 260:
			lamp = not lamp
		elif p.x >= 400 and p.x < 600 and p.y >= 140 and p.y < 260:
			channel = "A"
		elif p.x >= 640 and p.x < 840 and p.y >= 140 and p.y < 260:
			channel = "B"
		elif p.x >= 880 and p.x < 1080 and p.y >= 140 and p.y < 260:
			channel = "C"
		elif p.x >= 200 and p.x < 560 and p.y >= 400 and p.y < 560:
			armed = true
		elif p.x >= 720 and p.x < 1080 and p.y >= 400 and p.y < 560:
			if armed:
				shots += 1
				armed = false
		_refresh()
