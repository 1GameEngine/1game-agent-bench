extends Node2D
var tab: String = "red"
var count_red: int = 0
var count_blue: int = 0
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
	_add_btn("red", 80, 80, 280, 128, "Red")
	_add_btn("blue", 400, 80, 280, 128, "Blue")
	_add_btn("act", 440, 360, 400, 160, "Act")
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
	_hud.text = "%s %s/%s" % [tab, count_red, count_blue]
	if _btns.has("red"):
		_btns["red"].color = Color("dc2626") if tab == "red" else Color("7f1d1d")
	if _btns.has("blue"):
		_btns["blue"].color = Color("2563eb") if tab == "blue" else Color("1e3a8a")


func _input(event) -> void:
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		var p = event.position
		if p.x >= 80 and p.x < 360 and p.y >= 80 and p.y < 208:
			tab = "red"
		elif p.x >= 400 and p.x < 680 and p.y >= 80 and p.y < 208:
			tab = "blue"
		elif p.x >= 440 and p.x < 840 and p.y >= 360 and p.y < 520:
			if tab == "red":
				count_red += 1
			else:
				count_blue += 1
		_refresh()
