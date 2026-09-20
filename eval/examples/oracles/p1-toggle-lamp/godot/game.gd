extends Node2D
var on: bool = false
func _input(event):
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		var p = event.position
		if p.x >= 110 and p.x < 210 and p.y >= 70 and p.y < 110:
			on = not on
