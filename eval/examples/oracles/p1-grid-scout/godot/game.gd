extends Node2D
var x: int = 1
var marked: Array = [false, false, false]
var _hud: Label
var _cells: Array = []

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
	for i in 3:
		var cell := ColorRect.new()
		cell.position = Vector2(80 + i * 400, 200)
		cell.size = Vector2(320, 320)
		cell.mouse_filter = Control.MOUSE_FILTER_IGNORE
		add_child(cell)
		_cells.append(cell)
	_refresh()

func _refresh() -> void:
	_hud.text = "x=%s marks=%s%s%s" % [x, int(marked[0]), int(marked[1]), int(marked[2])]
	for i in 3:
		if x == i:
			_cells[i].color = Color("f59e0b") if marked[i] else Color("1d4ed8")
		else:
			_cells[i].color = Color("22c55e") if marked[i] else Color("1f2937")

func _input(event) -> void:
	if event is InputEventKey and event.pressed and not event.echo:
		if event.keycode == KEY_RIGHT:
			x = mini(2, x + 1)
		elif event.keycode == KEY_LEFT:
			x = maxi(0, x - 1)
		elif event.keycode == KEY_SPACE:
			marked[x] = true
		_refresh()
