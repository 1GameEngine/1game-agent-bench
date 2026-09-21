extends Node2D
var power: bool = false
var track: int = 0
var armed: Array = [false, false, false]
var shots: Array = [0, 0, 0]
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
	_hud.position = Vector2(40, 20)
	_hud.size = Vector2(1200, 72)
	_hud.add_theme_font_size_override("font_size", 32)
	add_child(_hud)
	_add_btn("power", 80, 120, 240, 100, "Power")
	_add_btn("t0", 360, 120, 160, 100, "0")
	_add_btn("t1", 560, 120, 160, 100, "1")
	_add_btn("t2", 760, 120, 160, 100, "2")
	_add_btn("arm", 200, 400, 360, 140, "Arm")
	_add_btn("fire", 720, 400, 360, 140, "Fire")
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
	lab.position = Vector2(x, y + maxi(0, int(h / 2) - 28))
	lab.size = Vector2(w, mini(h, 80))
	lab.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	lab.text = caption
	lab.add_theme_font_size_override("font_size", 40)
	add_child(lab)

func _paint(id: String, on: bool) -> void:
	if _btns.has(id):
		_btns[id].color = Color("fbbf24") if on else Color("2563eb")

func _refresh() -> void:
	_hud.text = "power=%s track=%s armed=%s%s%s shots=%s%s%s" % [power, track, int(armed[0]), int(armed[1]), int(armed[2]), shots[0], shots[1], shots[2]]
	_paint("power", power)
	_paint("t0", track == 0)
	_paint("t1", track == 1)
	_paint("t2", track == 2)
	_paint("arm", armed[track])

func _input(event) -> void:
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		var p = event.position
		if p.x >= 80 and p.x < 320 and p.y >= 120 and p.y < 220:
			power = not power
		elif p.x >= 360 and p.x < 520 and p.y >= 120 and p.y < 220:
			track = 0
		elif p.x >= 560 and p.x < 720 and p.y >= 120 and p.y < 220:
			track = 1
		elif p.x >= 760 and p.x < 920 and p.y >= 120 and p.y < 220:
			track = 2
		elif p.x >= 200 and p.x < 560 and p.y >= 400 and p.y < 540:
			if power:
				armed = [false, false, false]
				armed[track] = true
		elif p.x >= 720 and p.x < 1080 and p.y >= 400 and p.y < 540:
			if power and armed[track]:
				shots[track] += 1
				armed[track] = false
		_refresh()
