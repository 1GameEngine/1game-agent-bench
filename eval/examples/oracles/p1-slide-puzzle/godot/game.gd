extends Node2D

const START := [1, 5, 2, 4, 0, 6, 7, 3, 8]
const GOAL := [1, 2, 3, 4, 5, 6, 7, 8, 0]
const LIMIT := 14
const COLORS := [
	Color("e85d4c"), Color("f4a261"), Color("e9c46a"), Color("2a9d8f"),
	Color("457b9d"), Color("5e60ce"), Color("9b5de5"), Color("f15bb5")
]

var phase := "ready"
var moves := 0
var resets := 0
var board: Array = []
var _cells: Array[ColorRect] = []
var _nums: Array[Label] = []
var _hud: Label
var _resets: Label
var _banner: Label

func _ready() -> void:
	board = START.duplicate()
	var bg := ColorRect.new()
	bg.position = Vector2.ZERO
	bg.size = Vector2(1280, 720)
	bg.color = Color("10243a")
	bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(bg)
	_title("Slide Puzzle", 80, 28, 1120, 72, 56, Color("f8fafc"))
	for i in 9:
		var cell := ColorRect.new()
		cell.mouse_filter = Control.MOUSE_FILTER_IGNORE
		cell.size = Vector2(144, 144)
		add_child(cell)
		_cells.append(cell)
		var num := Label.new()
		num.mouse_filter = Control.MOUSE_FILTER_IGNORE
		num.size = Vector2(144, 144)
		num.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		num.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
		num.add_theme_font_size_override("font_size", 54)
		num.add_theme_color_override("font_color", Color("10243a"))
		add_child(num)
		_nums.append(num)
	_button(60, 620, 240, 70, Color("f4a261"), "Reset", Color("10243a"))
	_button(440, 620, 400, 70, Color("2a9d8f"), "Start", Color("f8fafc"))
	_hud = _title("", 900, 150, 340, 48, 32, Color("f8fafc"))
	_resets = _title("", 900, 210, 340, 48, 32, Color("f8fafc"))
	_banner = _title("", 900, 300, 340, 64, 36, Color("fef08a"))
	_refresh()

func _title(text: String, x: float, y: float, w: float, h: float, size: int, color: Color) -> Label:
	var lab := Label.new()
	lab.position = Vector2(x, y)
	lab.size = Vector2(w, h)
	lab.text = text
	lab.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	lab.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	lab.mouse_filter = Control.MOUSE_FILTER_IGNORE
	lab.add_theme_font_size_override("font_size", size)
	lab.add_theme_color_override("font_color", color)
	add_child(lab)
	return lab

func _button(x: float, y: float, w: float, h: float, color: Color, text: String, ink: Color) -> void:
	var rect := ColorRect.new()
	rect.position = Vector2(x, y)
	rect.size = Vector2(w, h)
	rect.color = color
	rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(rect)
	_title(text, x, y, w, h, 32, ink)

func _process(_delta: float) -> void:
	_refresh()

func _ended() -> bool:
	return phase == "clear" or phase == "fail"

func _settle() -> void:
	if _same(board, GOAL):
		phase = "clear"
	elif moves >= LIMIT:
		phase = "fail"

func _same(a: Array, b: Array) -> bool:
	for i in a.size():
		if int(a[i]) != int(b[i]):
			return false
	return true

func _slide(key: String) -> void:
	if phase != "playing":
		return
	var z := board.find(0)
	var delta := 0
	if key == "ArrowLeft":
		delta = 1
	elif key == "ArrowRight":
		delta = -1
	elif key == "ArrowUp":
		delta = 3
	elif key == "ArrowDown":
		delta = -3
	if delta == 0:
		return
	var t := z + delta
	if t < 0 or t > 8:
		return
	if abs(delta) == 1 and int(t / 3) != int(z / 3):
		return
	var swap = board[t]
	board[z] = swap
	board[t] = 0
	moves += 1
	_settle()

func _reset() -> void:
	if phase != "playing":
		return
	board = START.duplicate()
	resets += 1

func _input(event: InputEvent) -> void:
	if _ended():
		return
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		_click(event.position)
	elif event is InputEventKey and event.pressed and not event.echo:
		var code := _code(event.keycode)
		if code == "Enter":
			if phase == "ready":
				phase = "playing"
		elif code == "KeyR":
			_reset()
		else:
			_slide(code)
	_refresh()

func _click(p: Vector2) -> void:
	if p.x >= 440 and p.x < 840 and p.y >= 620 and p.y < 690:
		if phase == "ready":
			phase = "playing"
		return
	if phase != "playing":
		return
	if p.x >= 60 and p.x < 300 and p.y >= 620 and p.y < 690:
		_reset()
		return
	if p.x < 400 or p.y < 120 or p.x >= 880 or p.y >= 600:
		return
	var c := int((p.x - 400) / 160)
	var r := int((p.y - 120) / 160)
	if c < 0 or c > 2 or r < 0 or r > 2:
		return
	var idx := r * 3 + c
	var z := board.find(0)
	var same_row := int(idx / 3) == int(z / 3)
	var adj: bool = (same_row and abs(idx - z) == 1) or abs(idx - z) == 3
	if not adj:
		return
	var key := ""
	if idx == z + 1:
		key = "ArrowLeft"
	elif idx == z - 1:
		key = "ArrowRight"
	elif idx == z + 3:
		key = "ArrowUp"
	else:
		key = "ArrowDown"
	_slide(key)

func _code(key: Key) -> String:
	match key:
		KEY_LEFT:
			return "ArrowLeft"
		KEY_RIGHT:
			return "ArrowRight"
		KEY_UP:
			return "ArrowUp"
		KEY_DOWN:
			return "ArrowDown"
		KEY_ENTER, KEY_KP_ENTER:
			return "Enter"
		KEY_R:
			return "KeyR"
		_:
			return ""

func _refresh() -> void:
	for i in 9:
		var n := int(board[i])
		var c := i % 3
		var r := int(i / 3)
		var x := 400 + c * 160 + 8
		var y := 120 + r * 160 + 8
		_cells[i].position = Vector2(x, y)
		_nums[i].position = Vector2(x, y)
		if n == 0:
			_cells[i].color = Color("0b1726")
			_nums[i].text = ""
		else:
			_cells[i].color = COLORS[n - 1]
			_nums[i].text = str(n)
	if _hud:
		_hud.text = "moves %d / 14" % moves
	if _resets:
		_resets.text = "resets %d" % resets
	if _banner:
		if phase == "fail":
			_banner.text = "Puzzle fail"
		elif phase == "clear":
			_banner.text = "Puzzle clear"
		else:
			_banner.text = ""
