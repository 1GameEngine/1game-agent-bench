extends Node2D
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
	_hud.position = Vector2(48, 32)
	_hud.size = Vector2(1184, 96)
	_hud.add_theme_font_size_override("font_size", 64)
	add_child(_hud)
	_add_btn("arm", 200, 280, 360, 160, "Arm")
	_add_btn("fire", 720, 280, 360, 160, "Fire")
	_refresh()

func _add_btn(id: String, x: int, y: int, w: int, h: int, caption: String) -> void:
	var r := ColorRect.new()
	r.position = Vector2(x, y)
	r.size = Vector2(w, h)
	r.color = Color("2563eb")
	r.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(r)
	_btns[id] = r
	if caption != "":
		var lab := Label.new()
		lab.position = Vector2(x, y + maxi(0, int(h / 2) - 48))
		lab.size = Vector2(w, mini(h, 96))
		lab.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		lab.text = caption
		lab.add_theme_font_size_override("font_size", 64)
		add_child(lab)

func _refresh() -> void:
	_hud.text = "armed=%s shots=%s" % [armed, shots]
	if _btns.has("arm"):
		_btns["arm"].color = Color("fbbf24") if armed else Color("2563eb")


func _input(event) -> void:
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		var p = event.position
		if p.x >= 200 and p.x < 560 and p.y >= 280 and p.y < 440:
			armed = true
		elif p.x >= 720 and p.x < 1080 and p.y >= 280 and p.y < 440:
			if armed:
				shots += 1
				armed = false
		_refresh()
