extends Node2D
var stage: int = 0
func _input(event):
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		var p = event.position
		if p.x >= 50 and p.x < 140 and p.y >= 70 and p.y < 110:
			if stage == 0:
				stage = 1
		elif p.x >= 180 and p.x < 270 and p.y >= 70 and p.y < 110:
			if stage == 1:
				stage = 2
