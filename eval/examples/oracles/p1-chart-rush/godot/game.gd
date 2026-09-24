extends Node2D

## Clock twin: eval/pipeline/src/chart-oracle.mjs. Pipeline-only oracle, not a builder answer.

const LANE_X := [320, 480, 640, 800]
const NOTE_COUNT := 16
const COUNTDOWN_FRAMES := 90
const FALL_FRAMES := 120
const GAP_FRAMES := 30
const WINDOW := 4
const MISS_LIMIT := 6
const CLEAR_HITS := 12
const HIT_Y := 600.0
const SPAWN_Y := 150.0
const START_RECT := Rect2(460, 150, 360, 110)

var mode := "ready"
var countdown := 0
var play_frame := 0
var hits := 0
var misses := 0
var _consumed := {}
var _note_sprites: Array[Sprite2D] = []
var _bg: ColorRect
var _title: Label
var _start_fill: ColorRect
var _start: Label
var _count: Label
var _hits: Label
var _progress: Label
var _banner: Label
var _lane_tex: Array[Texture2D] = []

func _ready() -> void:
	set_process(false)
	set_physics_process(false)
	_bg = ColorRect.new()
	_bg.position = Vector2.ZERO
	_bg.size = Vector2(1280, 720)
	_bg.color = Color("140818")
	_bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_bg)
	for i in 4:
		var lane := ColorRect.new()
		lane.position = Vector2(LANE_X[i] - 36, 140)
		lane.size = Vector2(72, 490)
		lane.color = Color("2a1038")
		lane.mouse_filter = Control.MOUSE_FILTER_IGNORE
		add_child(lane)
		var tex: Texture2D = load("res://assets/arrow-%s.png" % ["left", "down", "up", "right"][i])
		_lane_tex.append(tex)
		var cap := Sprite2D.new()
		cap.texture = tex
		cap.position = Vector2(LANE_X[i], HIT_Y)
		cap.scale = Vector2(1.4, 1.4)
		add_child(cap)
	_title = _label(Vector2(80, 28), Vector2(1120, 80), 64, "Chart Rush")
	_start_fill = ColorRect.new()
	_start_fill.position = START_RECT.position
	_start_fill.size = START_RECT.size
	_start_fill.color = Color("7c3aed")
	_start_fill.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_start_fill)
	_start = _label(START_RECT.position, START_RECT.size, 64, "Start")
	_start.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_start.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	_count = _label(Vector2(440, 280), Vector2(400, 140), 96, "")
	_count.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_hits = _label(Vector2(80, 100), Vector2(400, 64), 40, "Hits 0")
	_progress = _label(Vector2(760, 100), Vector2(440, 64), 40, "")
	_banner = _label(Vector2(140, 300), Vector2(1000, 140), 88, "")
	_banner.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_refresh()

func _label(pos: Vector2, size: Vector2, font_size: int, text: String) -> Label:
	var lab := Label.new()
	lab.position = pos
	lab.size = size
	lab.text = text
	lab.add_theme_font_size_override("font_size", font_size)
	lab.add_theme_color_override("font_color", Color.WHITE)
	lab.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(lab)
	return lab

func _input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		if mode == "ready" and START_RECT.has_point(event.position):
			_begin()
		return
	if event is InputEventKey and event.pressed and not event.echo:
		if mode == "ready" and event.keycode == KEY_ENTER:
			_begin()
			return
		if mode != "playing":
			return
		var lane := -1
		match event.keycode:
			KEY_LEFT:
				lane = 0
			KEY_DOWN:
				lane = 1
			KEY_UP:
				lane = 2
			KEY_RIGHT:
				lane = 3
		if lane >= 0:
			_hit_lane(lane)

func _begin() -> void:
	mode = "countdown"
	countdown = COUNTDOWN_FRAMES
	play_frame = 0
	hits = 0
	misses = 0
	_consumed = {}

func _process(_dt: float) -> void:
	if mode == "countdown":
		countdown -= 1
		if countdown <= 0:
			mode = "playing"
			play_frame = 0
		_refresh()
		return
	if mode == "playing":
		_expire_misses()
		if mode == "playing":
			_finish_if_done()
		_layout_notes()
		if mode == "playing":
			play_frame += 1
		_refresh()
		return
	_layout_notes()
	_refresh()

func _hit_lane(lane: int) -> void:
	var best := -1
	var best_dist := WINDOW + 1
	for i in NOTE_COUNT:
		if i % 4 != lane or _consumed.has(i):
			continue
		var dist := absi(play_frame - GAP_FRAMES * (i + 1))
		if dist <= WINDOW and dist < best_dist:
			best = i
			best_dist = dist
	if best >= 0:
		_consumed[best] = true
		hits += 1
	else:
		misses += 1
		if misses >= MISS_LIMIT:
			mode = "fail"

func _expire_misses() -> void:
	for i in NOTE_COUNT:
		if _consumed.has(i):
			continue
		if play_frame > GAP_FRAMES * (i + 1) + WINDOW:
			_consumed[i] = true
			misses += 1
	if misses >= MISS_LIMIT:
		mode = "fail"

func _finish_if_done() -> void:
	if _consumed.size() < NOTE_COUNT:
		return
	mode = "clear" if hits >= CLEAR_HITS else "fail"

func _layout_notes() -> void:
	var want: Array[int] = []
	if mode == "playing":
		for i in NOTE_COUNT:
			if _consumed.has(i):
				continue
			var a := GAP_FRAMES * (i + 1)
			if play_frame < a - FALL_FRAMES or play_frame > a:
				continue
			want.append(i)
	while _note_sprites.size() < want.size():
		var spr := Sprite2D.new()
		spr.scale = Vector2(1.6, 1.6)
		add_child(spr)
		_note_sprites.append(spr)
	for n in _note_sprites.size():
		var spr: Sprite2D = _note_sprites[n]
		if n >= want.size():
			spr.visible = false
			continue
		var i := want[n]
		var a := GAP_FRAMES * (i + 1)
		var t := float(play_frame - (a - FALL_FRAMES)) / float(FALL_FRAMES)
		spr.texture = _lane_tex[i % 4]
		spr.position = Vector2(LANE_X[i % 4], lerpf(SPAWN_Y, HIT_Y, clampf(t, 0.0, 1.0)))
		spr.visible = true

func _refresh() -> void:
	_start_fill.visible = mode == "ready"
	_start.visible = mode == "ready"
	_count.visible = mode == "countdown"
	if mode == "countdown":
		_count.text = str(int(ceil(float(countdown) / 30.0)))
	_hits.text = "Hits %d" % hits
	_hits.visible = mode != "ready"
	if mode == "playing" or mode == "clear" or mode == "fail":
		_progress.text = "%d/%d" % [mini(hits + misses, NOTE_COUNT), NOTE_COUNT]
		_progress.visible = true
	else:
		_progress.visible = false
	if mode == "fail":
		_banner.text = "Chart miss"
		_banner.add_theme_color_override("font_color", Color("fb7185"))
	elif mode == "clear":
		_banner.text = "Chart clear"
		_banner.add_theme_color_override("font_color", Color("86efac"))
	else:
		_banner.text = ""
