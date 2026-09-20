extends Node2D
var slot: String = "A"
func _input(event):
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		var p = event.position
		if p.x >= 20 and p.x < 100 and p.y >= 70 and p.y < 110:
			slot = "A"
		elif p.x >= 120 and p.x < 200 and p.y >= 70 and p.y < 110:
			slot = "B"
		elif p.x >= 220 and p.x < 300 and p.y >= 70 and p.y < 110:
			slot = "C"
