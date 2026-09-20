extends Node2D
var left: bool = false
var right: bool = false
func _input(event):
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		var p = event.position
		if p.x >= 160 and p.x < 560 and p.y >= 280 and p.y < 440:
			left = true
		elif p.x >= 720 and p.x < 1120 and p.y >= 280 and p.y < 440:
			right = true
