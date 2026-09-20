extends Node2D
var armed: bool = false
var shots: int = 0
func _input(event):
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		var p = event.position
		if p.x >= 200 and p.x < 560 and p.y >= 280 and p.y < 440:
			armed = true
		elif p.x >= 720 and p.x < 1080 and p.y >= 280 and p.y < 440:
			if armed:
				shots += 1
				armed = false
