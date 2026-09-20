extends Node2D
var tab: String = "red"
var count_red: int = 0
var count_blue: int = 0
func _input(event):
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		var p = event.position
		if p.x >= 20 and p.x < 90 and p.y >= 20 and p.y < 52:
			tab = "red"
		elif p.x >= 100 and p.x < 170 and p.y >= 20 and p.y < 52:
			tab = "blue"
		elif p.x >= 110 and p.x < 210 and p.y >= 90 and p.y < 130:
			if tab == "red":
				count_red += 1
			else:
				count_blue += 1
