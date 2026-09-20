extends Node2D
var left: bool = false
var right: bool = false
func _input(event):
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		var p = event.position
		if p.x >= 40 and p.x < 140 and p.y >= 70 and p.y < 110:
			left = true
		elif p.x >= 180 and p.x < 280 and p.y >= 70 and p.y < 110:
			right = true
