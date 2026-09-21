extends Node2D
var px: int = 0
var py: int = 0
var b0x: int = 1
var b0y: int = 0
var b1x: int = 1
var b1y: int = 1
var cleared: bool = false
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
	_hud.position = Vector2(40, 16)
	_hud.size = Vector2(1200, 64)
	_hud.add_theme_font_size_override("font_size", 28)
	add_child(_hud)
	for y in 2:
		for x in 3:
			var cell := ColorRect.new()
			cell.position = Vector2(140 + x * 360, 400 - y * 240)
			cell.size = Vector2(280, 200)
			cell.mouse_filter = Control.MOUSE_FILTER_IGNORE
			add_child(cell)
			_cells.append(cell)
	_refresh()

func _in(x: int, y: int) -> bool:
	return x >= 0 and x <= 2 and y >= 0 and y <= 1

func _box(x: int, y: int) -> bool:
	return (b0x == x and b0y == y) or (b1x == x and b1y == y)

func _goals() -> bool:
	var a := "%s,%s" % [b0x, b0y]
	var b := "%s,%s" % [b1x, b1y]
	return (a == "2,0" or a == "2,1") and (b == "2,0" or b == "2,1") and a != b

func _try(dx: int, dy: int) -> void:
	var nx := px + dx
	var ny := py + dy
	if not _in(nx, ny):
		return
	if _box(nx, ny):
		var bx := nx + dx
		var by := ny + dy
		if not _in(bx, by) or _box(bx, by):
			return
		if b0x == nx and b0y == ny:
			b0x = bx
			b0y = by
		else:
			b1x = bx
			b1y = by
	px = nx
	py = ny
	cleared = _goals()

func _color(x: int, y: int) -> Color:
	var goal := x == 2
	var box := _box(x, y)
	var player := px == x and py == y
	if box and goal:
		return Color("f59e0b")
	if box:
		return Color("ea580c")
	if player:
		return Color("1d4ed8")
	if goal:
		return Color("14532d")
	return Color("1f2937")

func _refresh() -> void:
	_hud.text = "p=%s,%s b0=%s,%s b1=%s,%s cleared=%s" % [px, py, b0x, b0y, b1x, b1y, cleared]
	var i := 0
	for y in 2:
		for x in 3:
			_cells[i].color = _color(x, y)
			i += 1

func _input(event) -> void:
	if event is InputEventKey and event.pressed and not event.echo:
		if event.keycode == KEY_RIGHT:
			_try(1, 0)
		elif event.keycode == KEY_LEFT:
			_try(-1, 0)
		elif event.keycode == KEY_UP:
			_try(0, 1)
		elif event.keycode == KEY_DOWN:
			_try(0, -1)
		_refresh()
