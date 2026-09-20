extends Node2D
var armed: bool = false
var shots: int = 0
func _input(event):
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		var p = event.position
		if p.x >= 50 and p.x < 140 and p.y >= 70 and p.y < 110:
			armed = true
		elif p.x >= 180 and p.x < 270 and p.y >= 70 and p.y < 110:
			if armed:
				shots += 1
				armed = false
