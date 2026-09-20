extends Node2D
var on: bool = false
func _input(event):
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		var p = event.position
		if p.x >= 440 and p.x < 840 and p.y >= 280 and p.y < 440:
			on = not on
