extends Node2D
var value: int = 0
func _input(event):
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		var p = event.position
		if p.x >= 180 and p.x < 260 and p.y >= 70 and p.y < 110:
			value = mini(3, value + 1)
		elif p.x >= 60 and p.x < 140 and p.y >= 70 and p.y < 110:
			value = maxi(0, value - 1)
