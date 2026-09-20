extends Node2D
var held: bool = false
var pulses: int = 0
func _input(event):
	if event is InputEventKey and event.keycode == KEY_SPACE and not event.echo:
		if event.pressed:
			held = true
		else:
			held = false
			pulses += 1
