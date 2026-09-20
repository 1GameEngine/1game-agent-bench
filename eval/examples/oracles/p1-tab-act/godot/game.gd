extends Node2D
var tab: String = "red"
var count_red: int = 0
var count_blue: int = 0
func _input(event):
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
