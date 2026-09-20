extends Node

## Injected autoload. Reads a job JSON outside the game tree and drives the closed action set.

var _job: Dictionary = {}
var _out_path: String = ""
var _stills_dir: String = ""
var _schema_keys: PackedStringArray = PackedStringArray()

func _ready() -> void:
	var job_path := ""
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--job="):
			job_path = a.substr(6)
		elif a.begins_with("--out="):
			_out_path = a.substr(6)
	if job_path == "" or _out_path == "":
		_emit({"event": "error", "code": "EVAL_INTERNAL", "message": "missing --job or --out"})
		get_tree().quit(2)
		return
	var f := FileAccess.open(job_path, FileAccess.READ)
	if f == null:
		_emit({"event": "error", "code": "EVAL_INTERNAL", "message": "job unreadable"})
		get_tree().quit(2)
		return
	var parsed: Variant = JSON.parse_string(f.get_as_text())
	if typeof(parsed) != TYPE_DICTIONARY:
		_emit({"event": "error", "code": "EVAL_INTERNAL", "message": "job not object"})
		get_tree().quit(2)
		return
	_job = parsed
	_stills_dir = String(_job.get("stills_dir", ""))
	if _stills_dir != "":
		DirAccess.make_dir_recursive_absolute(_stills_dir)
	for k in _job.get("schema_keys", []):
		_schema_keys.append(String(k))
	call_deferred("_run")

func _lock_logical_viewport() -> void:
	var win := get_window()
	if win != null:
		win.mode = Window.MODE_WINDOWED
		win.size = Vector2i(320, 180)
		win.content_scale_size = Vector2i(320, 180)
		win.content_scale_mode = Window.CONTENT_SCALE_MODE_VIEWPORT
		win.content_scale_aspect = Window.CONTENT_SCALE_ASPECT_IGNORE
	DisplayServer.window_set_size(Vector2i(320, 180))
	get_viewport().size = Vector2i(320, 180)

func _run() -> void:
	_lock_logical_viewport()
	await get_tree().process_frame
	await RenderingServer.frame_post_draw
	if get_tree().current_scene == null:
		_emit({"event": "error", "code": "BOOT_FAIL", "message": "no current_scene"})
		get_tree().quit(3)
		return
	var probe := get_node_or_null("/root/EvalProbe")
	if probe == null or not probe.has_method("dump"):
		_emit({"event": "error", "code": "INJECT_TAMPER", "message": "EvalProbe missing"})
		get_tree().quit(4)
		return
	var g0: Dictionary = probe.dump(String(_job["schema_id"]), String(_job["schema_sha256"]), _schema_keys)
	_emit({"event": "g0", "dump": g0})
	for step in _job.get("steps", []):
		var err := await _apply_step(step, probe)
		if err != "":
			_emit({"event": "error", "code": err, "step": step})
			get_tree().quit(5)
			return
	get_tree().paused = true
	var frozen: Dictionary = probe.dump(String(_job["schema_id"]), String(_job["schema_sha256"]), _schema_keys)
	_emit({"event": "frozen", "dump": frozen})
	get_tree().quit(0)

func _apply_step(step: Dictionary, probe: Node) -> String:
	if step.has("checkpoint"):
		var d: Dictionary = probe.dump(String(_job["schema_id"]), String(_job["schema_sha256"]), _schema_keys)
		_emit({"event": "checkpoint", "id": String(step["checkpoint"]), "dump": d})
		await _snapshot(String(step["checkpoint"]))
		return ""
	if step.has("tick"):
		var n := int(step["tick"])
		if n < 1:
			return "CLOCK_CONTRACT_FAIL"
		_ticks(n)
		return ""
	if step.has("click"):
		var name := String(step["click"])
		var regions: Dictionary = _job.get("geometry", {}).get("regions", {})
		if not regions.has(name):
			return "GEOM_MISS"
		var r: Dictionary = regions[name]
		var x := float(r["x"]) + float(r["w"]) / 2.0
		var y := float(r["y"]) + float(r["h"]) / 2.0
		_click(x, y)
		_ticks(int(_job.get("post_ticks_after_input", 1)))
		return ""
	if step.has("keydown"):
		_key(String(step["keydown"]), true)
		_ticks(int(_job.get("post_ticks_after_input", 1)))
		return ""
	if step.has("keyup"):
		_key(String(step["keyup"]), false)
		_ticks(int(_job.get("post_ticks_after_input", 1)))
		return ""
	return "ACTION_NOT_IN_CLOSED_SET"

func _ticks(n: int) -> void:
	var root := get_tree().current_scene
	for i in n:
		_process_tree(root, 0.016)

func _process_tree(node: Node, dt: float) -> void:
	if node.has_method("_process"):
		node._process(dt)
	for child in node.get_children():
		_process_tree(child, dt)

func _click(x: float, y: float) -> void:
	var press := InputEventMouseButton.new()
	press.button_index = MOUSE_BUTTON_LEFT
	press.pressed = true
	press.position = Vector2(x, y)
	press.global_position = Vector2(x, y)
	_deliver(press)
	var rel := InputEventMouseButton.new()
	rel.button_index = MOUSE_BUTTON_LEFT
	rel.pressed = false
	rel.position = Vector2(x, y)
	rel.global_position = Vector2(x, y)
	_deliver(rel)

func _key(code: String, pressed: bool) -> void:
	var e := InputEventKey.new()
	e.pressed = pressed
	e.echo = false
	e.keycode = _map_key(code)
	e.physical_keycode = e.keycode
	_deliver(e)

func _deliver(event: InputEvent) -> void:
	var root := get_tree().current_scene
	if root != null and root.has_method("_input"):
		root._input(event)
	else:
		get_tree().root.push_input(event)

func _map_key(code: String) -> Key:
	match code:
		"ArrowUp":
			return KEY_UP
		"ArrowDown":
			return KEY_DOWN
		"ArrowLeft":
			return KEY_LEFT
		"ArrowRight":
			return KEY_RIGHT
		"Space":
			return KEY_SPACE
		"Enter":
			return KEY_ENTER
		"KeyW":
			return KEY_W
		"KeyA":
			return KEY_A
		"KeyS":
			return KEY_S
		"KeyD":
			return KEY_D
		_:
			return KEY_NONE

func _snapshot(id: String) -> void:
	if _stills_dir == "":
		return
	_lock_logical_viewport()
	RenderingServer.force_draw(true)
	await get_tree().process_frame
	await RenderingServer.frame_post_draw
	var tex := get_viewport().get_texture()
	if tex == null:
		_emit({"event": "still_fail", "id": id, "message": "no viewport texture"})
		return
	var img := tex.get_image()
	if img == null or img.get_width() < 1 or img.get_height() < 1:
		_emit({"event": "still_fail", "id": id, "message": "no image"})
		return
	if img.get_width() != 320 or img.get_height() != 180:
		_emit({
			"event": "still_fail",
			"id": id,
			"message": "size %sx%s (need 320x180)" % [img.get_width(), img.get_height()],
		})
		return
	var path := "%s/%s.png" % [_stills_dir, id]
	var err := img.save_png(path)
	if err != OK:
		_emit({"event": "still_fail", "id": id, "message": "save_png %s" % err})
		return
	_emit({"event": "still", "id": id, "path": path, "w": img.get_width(), "h": img.get_height()})

func _emit(obj: Dictionary) -> void:
	var f := FileAccess.open(_out_path, FileAccess.READ_WRITE)
	if f == null:
		f = FileAccess.open(_out_path, FileAccess.WRITE)
	else:
		f.seek_end()
	f.store_line(JSON.stringify(obj))
	f.flush()
