extends Node

## Injected autoload. Reads a job JSON outside the game tree and drives the closed action set.
## Window and gameplay are both 1280×720. Stills come from a dedicated SubViewport
## so Dummy/headless root textures cannot yield an empty PNG.

const STILL_W := 1280
const STILL_H := 720

var _job: Dictionary = {}
var _out_path: String = ""
var _stills_dir: String = ""
var _schema_keys: PackedStringArray = PackedStringArray()
var _cap: SubViewport
var _pressed_keys: Dictionary = {}
var _pointer_pressed := false
var _pointer_position := Vector2.ZERO
var _capture_modes: Dictionary = {}

func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	Input.use_accumulated_input = false
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
	if _job.has("traces"):
		# Freeze before the first scene is loaded, including SceneTreeTimer's
		# default process_always behavior during reload and capture waits.
		get_tree().paused = true
		Engine.time_scale = 0.0
	_stills_dir = String(_job.get("stills_dir", ""))
	if _stills_dir != "":
		DirAccess.make_dir_recursive_absolute(_stills_dir)
	for k in _job.get("schema_keys", []):
		_schema_keys.append(String(k))
	call_deferred("_run")

func _lock_window() -> void:
	var win := get_window()
	if win != null:
		win.mode = Window.MODE_WINDOWED
		win.size = Vector2i(STILL_W, STILL_H)
		win.content_scale_size = Vector2i(STILL_W, STILL_H)
		win.content_scale_mode = Window.CONTENT_SCALE_MODE_DISABLED
	DisplayServer.window_set_size(Vector2i(STILL_W, STILL_H))
	var vp := get_viewport()
	vp.size = Vector2i(STILL_W, STILL_H)
	vp.canvas_item_default_texture_filter = Viewport.DEFAULT_CANVAS_ITEM_TEXTURE_FILTER_NEAREST

func _ensure_cap() -> void:
	if _cap != null or _stills_dir == "":
		return
	_cap = SubViewport.new()
	_cap.name = "EvalStillViewport"
	_cap.size = Vector2i(STILL_W, STILL_H)
	_cap.transparent_bg = false
	_cap.disable_3d = true
	_cap.handle_input_locally = false
	_cap.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	_cap.canvas_item_default_texture_filter = Viewport.DEFAULT_CANVAS_ITEM_TEXTURE_FILTER_NEAREST
	_cap.world_2d = get_tree().root.world_2d
	_cap.canvas_transform = Transform2D.IDENTITY
	add_child(_cap)

func _run() -> void:
	_lock_window()
	await get_tree().process_frame
	if get_tree().current_scene == null:
		_emit({"event": "error", "code": "BOOT_FAIL", "message": "no current_scene"})
		get_tree().quit(3)
		return
	var probe := get_node_or_null("/root/EvalProbe")
	if probe == null or not probe.has_method("dump"):
		_emit({"event": "error", "code": "INJECT_TAMPER", "message": "EvalProbe missing"})
		get_tree().quit(4)
		return
	if _job.has("traces"):
		await _run_traces()
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

func _run_traces() -> void:
	_emit({"event": "g0", "dump": {}})
	var sample_every := int(_job.get("sample_every", 15))
	var max_frames := int(_job.get("max_frames", 600))
	var dt := float(_job.get("frame_dt", 1.0 / 30.0))
	# Advance the engine itself: script callbacks, timers, tweens and input edge
	# state must all observe the same fixed frame, regardless of capture cadence.
	Engine.physics_ticks_per_second = int(round(1.0 / dt))
	Engine.max_physics_steps_per_frame = 1
	get_tree().paused = true
	Engine.time_scale = 0.0
	get_tree().node_added.connect(_watch_trace_node)
	for trace in _job.get("traces", []):
		# Each trace starts from a fresh input state, even if the previous trace
		# legitimately ended with a key or pointer still pressed.
		_reset_input()
		_capture_modes.clear()
		get_tree().reload_current_scene()
		await get_tree().process_frame
		await get_tree().process_frame
		_lock_window()
		_freeze_capture_modes(get_tree().current_scene)
		var scenario := String(trace.get("scenario", "play"))
		var n := int(trace.get("duration_frames", 1))
		if n > max_frames:
			_emit({"event": "error", "code": "TRACE_TOO_LONG", "scenario": scenario, "frames": n, "max_frames": max_frames})
			get_tree().quit(5)
			return
		var by := {}
		for ev in trace.get("events", []):
			var fr := int(ev.get("frame", 0))
			if not by.has(fr):
				by[fr] = []
			by[fr].append(ev)
		for f in n:
			var err := await _trace_frame(by.get(f, []))
			if err != "":
				_emit({"event": "error", "code": err, "scenario": scenario, "frame": f})
				get_tree().quit(5)
				return
			if sample_every > 0 and (f % sample_every == 0 or f == n - 1):
				await _snapshot("%s_f%s" % [scenario, f])
		_emit({"event": "trace_done", "scenario": scenario, "frames": n})
	get_tree().paused = true
	get_tree().quit(0)

func _apply_trace_event(ev: Dictionary) -> String:
	var kind := String(ev.get("type", ""))
	if kind == "click":
		_click(float(ev.get("x", 0)), float(ev.get("y", 0)))
		return ""
	if kind == "mouse_down":
		_pointer(float(ev.get("x", 0)), float(ev.get("y", 0)), true)
		return ""
	if kind == "mouse_up":
		_pointer(float(ev.get("x", 0)), float(ev.get("y", 0)), false)
		return ""
	if kind == "mouse_move":
		_motion(float(ev.get("x", 0)), float(ev.get("y", 0)))
		return ""
	if kind == "keydown":
		_key(String(ev.get("code", "")), true)
		return ""
	if kind == "keyup":
		_key(String(ev.get("code", "")), false)
		return ""
	return "ACTION_NOT_IN_CLOSED_SET"

func _trace_frame(events: Array) -> String:
	# Enter at the beginning of a fixed native frame, before physics or idle
	# processing. Freeze only after both phases, timers and tweens have finished.
	Engine.time_scale = 1.0
	await get_tree().physics_frame
	_restore_capture_modes()
	get_tree().paused = false
	for ev in events:
		var err := _apply_trace_event(ev)
		if err != "":
			get_tree().paused = true
			Engine.time_scale = 0.0
			return err
	await RenderingServer.frame_post_draw
	get_tree().paused = true
	Engine.time_scale = 0.0
	_freeze_capture_modes(get_tree().current_scene)
	return ""

func _freeze_capture_modes(node: Node) -> void:
	# Explicit always/when-paused nodes otherwise run during screenshot waits.
	# Inherited modes freeze through their parent; preserve game-selected modes.
	if node.process_mode in [Node.PROCESS_MODE_ALWAYS, Node.PROCESS_MODE_WHEN_PAUSED]:
		_capture_modes[node] = node.process_mode
		node.process_mode = Node.PROCESS_MODE_DISABLED
	for child in node.get_children():
		_freeze_capture_modes(child)

func _watch_trace_node(node: Node) -> void:
	if node == self or is_ancestor_of(node):
		return
	node.ready.connect(_freeze_ready_node.bind(node), CONNECT_ONE_SHOT)

func _freeze_ready_node(node: Node) -> void:
	# Godot 4.4 has no scene_changed signal. Freeze explicit always modes as
	# soon as a reloaded scene becomes ready, before any native callbacks run.
	if get_tree().paused:
		_freeze_capture_modes(node)

func _restore_capture_modes() -> void:
	for node in _capture_modes:
		if is_instance_valid(node):
			node.process_mode = _capture_modes[node]
	_capture_modes.clear()

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

func _pointer(x: float, y: float, pressed: bool) -> void:
	_pointer_pressed = pressed
	_motion(x, y)
	var e := InputEventMouseButton.new()
	e.button_index = MOUSE_BUTTON_LEFT
	e.pressed = pressed
	e.position = Vector2(x, y)
	e.global_position = Vector2(x, y)
	_deliver(e)

func _motion(x: float, y: float) -> void:
	_pointer_position = Vector2(x, y)
	get_tree().root.warp_mouse(Vector2(x, y))
	var e := InputEventMouseMotion.new()
	e.position = Vector2(x, y)
	e.global_position = Vector2(x, y)
	e.relative = Vector2.ZERO
	_deliver(e)

func _click(x: float, y: float) -> void:
	# A button event alone does not update the viewport's current mouse position.
	_motion(x, y)
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
	if pressed:
		_pressed_keys[code] = true
	else:
		_pressed_keys.erase(code)
	var e := InputEventKey.new()
	e.pressed = pressed
	e.echo = false
	e.keycode = _map_key(code)
	e.physical_keycode = e.keycode
	_deliver(e)

func _reset_input() -> void:
	for code in _pressed_keys.keys():
		_key(String(code), false)
	if _pointer_pressed:
		_pointer(_pointer_position.x, _pointer_position.y, false)

func _deliver(event: InputEvent) -> void:
	# Use the normal input pipeline, updating Input state and dispatching to
	# children, GUI controls and _unhandled_input as well as the root _input.
	# Dispatch is synchronous: unpause only for input, never for a real frame.
	var was_paused := get_tree().paused
	get_tree().paused = false
	Input.parse_input_event(event)
	Input.flush_buffered_events()
	get_tree().paused = was_paused

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
	await _capture_sample(id)

func _capture_sample(id: String) -> void:
	var keys: Array = _job.get("probe_keys", [])
	if not keys.is_empty():
		var root := get_tree().current_scene
		if root != null:
			var state := {}
			for k in keys:
				state[String(k)] = root.get(String(k))
			_emit({"event": "probe", "id": id, "state": state})
	if _stills_dir == "":
		return
	_lock_window()
	_ensure_cap()
	var img: Image = await _grab_still()
	if img == null:
		_emit({"event": "still_fail", "id": id, "message": "empty viewport image"})
		return
	var path := "%s/%s.png" % [_stills_dir, id]
	var err := img.save_png(path)
	if err != OK:
		_emit({"event": "still_fail", "id": id, "message": "save_png %s" % err})
		return
	_emit({"event": "still", "id": id, "path": path, "w": img.get_width(), "h": img.get_height()})

func _grab_still() -> Image:
	var tree := get_tree()
	var was_paused := tree.paused
	tree.paused = true
	var img: Image = null
	for _i in 3:
		RenderingServer.force_draw(true)
		await tree.process_frame
		img = _image_from(_cap)
		if _still_ok(img):
			break
		img = _image_from(get_viewport())
		if _still_ok(img):
			break
		img = null
	tree.paused = was_paused
	return img

func _image_from(vp: Viewport) -> Image:
	if vp == null:
		return null
	var tex := vp.get_texture()
	if tex == null:
		return null
	return tex.get_image()

func _still_ok(img: Image) -> bool:
	if img == null or img.get_width() != STILL_W or img.get_height() != STILL_H:
		return false
	img.convert(Image.FORMAT_RGBA8)
	var lit := 0
	var y := 0
	while y < STILL_H:
		var x := 0
		while x < STILL_W:
			var c := img.get_pixel(x, y)
			if c.r + c.g + c.b > 0.08:
				lit += 1
				if lit >= 8:
					return true
			x += 80
		y += 45
	return false

func _emit(obj: Dictionary) -> void:
	var f := FileAccess.open(_out_path, FileAccess.READ_WRITE)
	if f == null:
		f = FileAccess.open(_out_path, FileAccess.WRITE)
	else:
		f.seek_end()
	f.store_line(JSON.stringify(obj))
	f.flush()
