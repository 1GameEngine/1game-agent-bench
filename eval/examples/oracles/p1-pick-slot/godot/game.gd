extends Node2D
var slot: String = "A"
func _input(event):
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		var p = event.position
		if p.x >= 80 and p.x < 400 and p.y >= 280 and p.y < 440:
			slot = "A"
		elif p.x >= 480 and p.x < 800 and p.y >= 280 and p.y < 440:
			slot = "B"
		elif p.x >= 880 and p.x < 1200 and p.y >= 280 and p.y < 440:
			slot = "C"
