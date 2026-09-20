extends Node2D
var stage: int = 0
func _input(event):
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		var p = event.position
		if p.x >= 200 and p.x < 560 and p.y >= 280 and p.y < 440:
			if stage == 0:
				stage = 1
		elif p.x >= 720 and p.x < 1080 and p.y >= 280 and p.y < 440:
			if stage == 1:
				stage = 2
