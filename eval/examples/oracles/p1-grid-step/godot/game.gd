extends Node2D
var x: int = 1
var y: int = 1
func _input(event):
	if event is InputEventKey and event.pressed and not event.echo:
		if event.keycode == KEY_RIGHT:
			x = mini(2, x + 1)
		elif event.keycode == KEY_LEFT:
			x = maxi(0, x - 1)
		elif event.keycode == KEY_DOWN:
			y = mini(2, y + 1)
		elif event.keycode == KEY_UP:
			y = maxi(0, y - 1)
