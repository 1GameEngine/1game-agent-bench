extends Node2D

var cells: Array = ["", "", ""]
var turn: String = "X"
var _marks: Array = []

func _ready() -> void:
	var bg := ColorRect.new()
	bg.position = Vector2.ZERO
	bg.size = Vector2(1280, 720)
	bg.color = Color("0f1224")
	bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(bg)
	var hud := Label.new()
	hud.name = "Hud"
	hud.position = Vector2(48, 32)
	hud.size = Vector2(1184, 96)
	hud.add_theme_font_size_override("font_size", 64)
	add_child(hud)
	var xs := [80, 480, 880]
	for i in 3:
		var cell := ColorRect.new()
		cell.position = Vector2(xs[i], 200)
		cell.size = Vector2(320, 320)
		cell.color = Color("1f2937")
		cell.mouse_filter = Control.MOUSE_FILTER_IGNORE
		add_child(cell)
		var mark := Label.new()
		mark.position = Vector2(xs[i], 296)
		mark.size = Vector2(320, 128)
		mark.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		mark.add_theme_font_size_override("font_size", 112)
		add_child(mark)
		_marks.append(mark)
	_refresh()

func _refresh() -> void:
	$Hud.text = "turn=%s" % turn
	for i in 3:
		_marks[i].text = String(cells[i])

func _input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		var p: Vector2 = event.position
		var xs := [80, 480, 880]
		for i in 3:
			if p.x >= xs[i] and p.x < xs[i] + 320 and p.y >= 200 and p.y < 520:
				if String(cells[i]) != "":
					return
				cells[i] = turn
				turn = "O" if turn == "X" else "X"
				_refresh()
				return
