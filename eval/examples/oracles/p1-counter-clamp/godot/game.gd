extends Node2D
var value: int = 0
func _input(event):
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		var p = event.position
		if p.x >= 720 and p.x < 1040 and p.y >= 280 and p.y < 440:
			value = mini(3, value + 1)
		elif p.x >= 240 and p.x < 560 and p.y >= 280 and p.y < 440:
			value = maxi(0, value - 1)
