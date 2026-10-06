extends Node2D

const W := 1280.0
const H := 720.0

const NOTE_INTERVAL := 0.4
const APPROACH_TIME := 0.85
const COUNTDOWN_SEC := 2.7
const TOTAL_NOTES := 16
const HOLD_DURATION := 0.8
const HOLD_NOTE_IDX := [4, 8]

const JUDGE_Y := 580.0
const SPAWN_Y := 280.0
const LANE_X := [280.0, 520.0, 760.0, 1000.0]

const START_RECT := Rect2(490.0, 140.0, 300.0, 90.0)

const BASE_SCORE := { "Perfect": 300, "Great": 200, "Good": 100, "Miss": 0 }

enum Phase { TITLE, COUNTDOWN, PLAYING, END_FAIL, END_CLEAR }

var _phase := Phase.TITLE
var _play_clock := 0.0
var _countdown_left := 0.0
var _countdown_show := 0

var _score := 0
var _combo := 0
var _multiplier := 1
var _health := 100.0
const HEALTH_MAX := 100.0

var _counts := { "Perfect": 0, "Great": 0, "Good": 0, "Miss": 0 }
var _hits := 0

var _notes: Array = []
var _next_spawn_idx := 0
var _resolved := 0

var _held_lane := -1
var _active_hold: Dictionary = {}

var _tex: Array = []
var _keys_down := {}

var _fx: Array = []

func _ready() -> void:
	for name in ["arrow-left", "arrow-down", "arrow-up", "arrow-right"]:
		var p := "res://assets/%s.png" % name
		if ResourceLoader.exists(p):
			_tex.append(load(p))
		else:
			_tex.append(null)
	queue_redraw()

func _process(delta: float) -> void:
	match _phase:
		Phase.TITLE:
			pass
		Phase.COUNTDOWN:
			_countdown_left -= delta
			var show := int(ceil(_countdown_left))
			if show != _countdown_show:
				_countdown_show = show
			if _countdown_left <= 0.0:
				_phase = Phase.PLAYING
				_play_clock = 0.0
				_spawn_upcoming()
		Phase.PLAYING:
			_play_clock += delta
			_spawn_upcoming()
			_update_notes(delta)
			_update_holds(delta)
			if _health <= 0.0:
				_end_fail()
			elif _resolved >= TOTAL_NOTES:
				if _hits >= 12:
					_end_clear()
				else:
					_end_fail()
		Phase.END_FAIL, Phase.END_CLEAR:
			pass
	_tick_fx(delta)
	queue_redraw()

func _input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		if _phase == Phase.TITLE and START_RECT.has_point(event.position):
			_begin_countdown()
	if event is InputEventKey and not event.echo:
		var lane := _lane_from_key(event.keycode)
		if lane < 0:
			if event.pressed and event.keycode == KEY_ENTER and _phase == Phase.TITLE:
				_begin_countdown()
			return
		var code := _code_from_lane(lane)
		if event.pressed:
			if _keys_down.has(code):
				return
			_keys_down[code] = true
			if _phase == Phase.PLAYING:
				_on_lane_press(lane)
		else:
			_keys_down.erase(code)
			if _phase == Phase.PLAYING:
				_on_lane_release(lane)

func _begin_countdown() -> void:
	_phase = Phase.COUNTDOWN
	_countdown_left = COUNTDOWN_SEC
	_countdown_show = int(ceil(_countdown_left))
	_score = 0
	_combo = 0
	_multiplier = 1
	_health = HEALTH_MAX
	_counts = { "Perfect": 0, "Great": 0, "Good": 0, "Miss": 0 }
	_hits = 0
	_notes.clear()
	_next_spawn_idx = 0
	_resolved = 0
	_held_lane = -1
	_active_hold = {}
	_fx.clear()

func _spawn_upcoming() -> void:
	while _next_spawn_idx < TOTAL_NOTES:
		var spawn_t := float(_next_spawn_idx) * NOTE_INTERVAL
		if _play_clock + 0.0001 < spawn_t:
			break
		var lane := _next_spawn_idx % 4
		var hold := _next_spawn_idx in HOLD_NOTE_IDX
		_notes.append({
			"idx": _next_spawn_idx,
			"lane": lane,
			"spawn_t": spawn_t,
			"hit_t": spawn_t + APPROACH_TIME,
			"hold": hold,
			"hold_end": spawn_t + APPROACH_TIME + (HOLD_DURATION if hold else 0.0),
			"done": false,
			"missing": false,
		})
		_next_spawn_idx += 1

func _update_notes(_delta: float) -> void:
	for n in _notes:
		if n.done:
			continue
		if n.hold and _active_hold.get("idx", -1) == n.idx:
			continue
		var late: float = _play_clock - float(n.hit_t) - 0.15
		if late > 0.0 and not n.missing:
			_register_miss(n, true)

func _update_holds(delta: float) -> void:
	if _active_hold.is_empty():
		return
	var n = _find_note(_active_hold.idx)
	if n.is_empty() or n.done:
		_active_hold = {}
		_held_lane = -1
		return
	if _held_lane != n.lane:
		_register_miss(n, true)
		_active_hold = {}
		_held_lane = -1
		return
	if _play_clock >= n.hold_end:
		_resolve_hit(n, String(_active_hold.get("tier", "Good")))
		_active_hold = {}
		_held_lane = -1

func _on_lane_press(lane: int) -> void:
	var best: Dictionary = {}
	var best_d := 999.0
	for n in _notes:
		if n.done or n.lane != lane:
			continue
		if n.hold and _active_hold.has("idx") and _active_hold.idx != n.idx:
			continue
		var d := absf(_play_clock - n.hit_t)
		if d <= 0.15 and d < best_d:
			best = n
			best_d = d
	if best.is_empty():
		for n in _notes:
			if n.done:
				continue
			var d := absf(_play_clock - n.hit_t)
			if d <= 0.15 and d < best_d:
				best = n
				best_d = d
		if not best.is_empty() and best.lane != lane:
			_register_miss(best, false)
			return
		return
	if best.hold:
		var tier := _tier_for_delta(_play_clock - best.hit_t)
		if tier == "Miss":
			_register_miss(best, false)
			return
		_active_hold = { "idx": best.idx, "tier": tier }
		_held_lane = lane
		best.missing = true
	else:
		var tier := _tier_for_delta(_play_clock - best.hit_t)
		if tier == "Miss":
			_register_miss(best, false)
		else:
			_resolve_hit(best, tier)

func _on_lane_release(lane: int) -> void:
	if _active_hold.is_empty():
		return
	var n = _find_note(_active_hold.idx)
	if not n.is_empty() and n.lane == lane and _play_clock < n.hold_end:
		_register_miss(n, true)
		_active_hold = {}
		_held_lane = -1

func _tier_for_delta(dt: float) -> String:
	var ad := absf(dt)
	if ad <= 0.05:
		return "Perfect"
	if ad <= 0.10:
		return "Great"
	if ad <= 0.15:
		return "Good"
	return "Miss"

func _register_miss(n: Dictionary, consume: bool) -> void:
	_counts.Miss += 1
	_combo = 0
	_multiplier = 1
	_health = maxf(0.0, _health - 12.0)
	_fx.append({ "kind": "Miss", "lane": n.lane, "t": 0.45 })
	if consume:
		n.done = true
		_resolved += 1

func _resolve_hit(n: Dictionary, tier: String) -> void:
	if n.done:
		return
	n.done = true
	_resolved += 1
	_counts[tier] += 1
	_hits += 1
	_combo += 1
	_multiplier = _combo_multiplier()
	_score += BASE_SCORE[tier] * _multiplier
	if tier == "Perfect":
		_health = minf(HEALTH_MAX, _health + 4.0)
	_fx.append({ "kind": tier, "lane": n.lane, "t": 0.55 })

func _combo_multiplier() -> int:
	if _combo >= 12:
		return 8
	if _combo >= 8:
		return 4
	if _combo >= 4:
		return 2
	return 1

func _find_note(idx: int) -> Dictionary:
	for n in _notes:
		if n.idx == idx:
			return n
	return {}

func _end_fail() -> void:
	_phase = Phase.END_FAIL
	_notes.clear()
	_active_hold = {}

func _end_clear() -> void:
	_phase = Phase.END_CLEAR
	_notes.clear()
	_active_hold = {}

func _tick_fx(delta: float) -> void:
	var i := 0
	while i < _fx.size():
		_fx[i].t -= delta
		if _fx[i].t <= 0.0:
			_fx.remove_at(i)
		else:
			i += 1

func _accuracy_pct() -> float:
	var total: int = _hits + int(_counts.Miss)
	if total <= 0:
		return 0.0
	return 100.0 * float(_hits) / float(total)

func _grade_letter() -> String:
	var acc := _accuracy_pct()
	if acc >= 95.0:
		return "S"
	if acc >= 85.0:
		return "A"
	if acc >= 70.0:
		return "B"
	if acc >= 50.0:
		return "C"
	return "F"

func _lane_from_key(keycode: Key) -> int:
	match keycode:
		KEY_LEFT, KEY_A:
			return 0
		KEY_DOWN, KEY_S:
			return 1
		KEY_UP, KEY_W:
			return 2
		KEY_RIGHT, KEY_D:
			return 3
		_:
			return -1

func _code_from_lane(lane: int) -> String:
	return ["ArrowLeft", "ArrowDown", "ArrowUp", "ArrowRight"][lane]

func _draw() -> void:
	_draw_bg()
	_draw_lanes()
	if _phase == Phase.TITLE:
		_draw_title()
	elif _phase == Phase.COUNTDOWN:
		_draw_title(false)
		_draw_countdown()
	elif _phase == Phase.PLAYING:
		_draw_hud()
		_draw_notes()
		_draw_fx()
	elif _phase == Phase.END_FAIL:
		_draw_end_fail()
	elif _phase == Phase.END_CLEAR:
		_draw_end_clear()

func _draw_bg() -> void:
	draw_rect(Rect2(0, 0, W, H), Color(0.06, 0.04, 0.12))
	for i in 4:
		var x0: float = LANE_X[i] - 70.0
		draw_rect(Rect2(x0, 120, 140, H - 140), Color(0.12, 0.08, 0.2, 0.55))

func _draw_lanes() -> void:
	draw_rect(Rect2(40, JUDGE_Y - 6, W - 80, 12), Color(0.9, 0.2, 0.75, 0.35))
	for i in 4:
		var cx: float = LANE_X[i]
		draw_line(Vector2(cx, 140), Vector2(cx, JUDGE_Y + 40), Color(0.35, 0.25, 0.55), 2.0)
		_blit_arrow(i, Vector2(cx - 32, JUDGE_Y + 18), 1.15)

func _draw_title(with_start := true) -> void:
	var font := ThemeDB.fallback_font
	draw_string(font, Vector2(420, 110), "Chart Rush", HORIZONTAL_ALIGNMENT_LEFT, -1, 56, Color(1, 0.85, 0.35))
	if with_start:
		draw_rect(START_RECT, Color(0.25, 0.55, 0.95))
		draw_rect(START_RECT, Color(0.5, 0.75, 1.0), false, 3.0)
		draw_string(font, Vector2(START_RECT.position.x + 92, START_RECT.position.y + 58), "Start", HORIZONTAL_ALIGNMENT_LEFT, -1, 36, Color.WHITE)

func _draw_countdown() -> void:
	var font := ThemeDB.fallback_font
	var txt := str(max(_countdown_show, 1))
	draw_string(font, Vector2(610, 360), txt, HORIZONTAL_ALIGNMENT_LEFT, -1, 96, Color(1, 0.4, 0.85))

func _draw_hud() -> void:
	var font := ThemeDB.fallback_font
	draw_string(font, Vector2(48, 48), "score: %d" % _score, HORIZONTAL_ALIGNMENT_LEFT, -1, 28, Color.WHITE)
	draw_string(font, Vector2(48, 82), "combo: %d  x%d" % [_combo, _multiplier], HORIZONTAL_ALIGNMENT_LEFT, -1, 26, Color(0.9, 0.95, 1))
	var bar_w := 360.0
	draw_rect(Rect2(W - bar_w - 48, 36, bar_w, 22), Color(0.15, 0.1, 0.2))
	draw_rect(Rect2(W - bar_w - 48, 36, bar_w * (_health / HEALTH_MAX), 22), Color(0.2, 0.85, 0.45))
	draw_string(font, Vector2(W - bar_w - 48, 78), "life", HORIZONTAL_ALIGNMENT_LEFT, -1, 20, Color(0.7, 0.85, 0.75))

func _draw_notes() -> void:
	for n in _notes:
		if n.done:
			continue
		var lane: int = n.lane
		var cx: float = LANE_X[lane]
		var hit_t: float = float(n.hit_t)
		var prog: float = 1.0 - (hit_t - _play_clock) / APPROACH_TIME
		prog = clampf(prog, 0.0, 1.15)
		var y: float = lerpf(SPAWN_Y, JUDGE_Y, prog)
		_blit_arrow(lane, Vector2(cx - 28, y - 28), 0.95)
		if n.hold:
			var tail_len := HOLD_DURATION / APPROACH_TIME * (JUDGE_Y - SPAWN_Y)
			var tail_top := y - tail_len
			draw_rect(Rect2(cx - 10, tail_top, 20, y - tail_top), Color(0.95, 0.55, 1.0, 0.55))

func _draw_fx() -> void:
	for f in _fx:
		var cx: float = LANE_X[int(f.lane)]
		var y: float = JUDGE_Y - 80.0
		var col := Color.WHITE
		match f.kind:
			"Perfect":
				col = Color(1, 0.85, 0.2)
				draw_circle(Vector2(cx, y), 22, col)
			"Great":
				col = Color(0.3, 0.95, 0.45)
				var pts := PackedVector2Array([
					Vector2(cx, y - 26), Vector2(cx + 26, y), Vector2(cx, y + 26), Vector2(cx - 26, y)
				])
				draw_colored_polygon(pts, col)
			"Good":
				col = Color(0.35, 0.65, 1)
				draw_rect(Rect2(cx - 22, y - 22, 44, 44), col)
			"Miss":
				col = Color(0.95, 0.25, 0.3)
				draw_line(Vector2(cx - 20, y - 20), Vector2(cx + 20, y + 20), col, 5.0)
				draw_line(Vector2(cx + 20, y - 20), Vector2(cx - 20, y + 20), col, 5.0)
		var font := ThemeDB.fallback_font
		draw_string(font, Vector2(cx - 40, y - 36), f.kind, HORIZONTAL_ALIGNMENT_LEFT, -1, 22, col)

func _draw_end_fail() -> void:
	var font := ThemeDB.fallback_font
	draw_rect(Rect2(0, 0, W, H), Color(0, 0, 0, 0.55))
	draw_string(font, Vector2(470, 320), "Chart miss", HORIZONTAL_ALIGNMENT_LEFT, -1, 52, Color(1, 0.35, 0.4))
	_draw_summary(380)

func _draw_end_clear() -> void:
	var font := ThemeDB.fallback_font
	draw_rect(Rect2(0, 0, W, H), Color(0, 0, 0, 0.45))
	draw_string(font, Vector2(450, 260), "Chart clear", HORIZONTAL_ALIGNMENT_LEFT, -1, 52, Color(0.45, 1, 0.65))
	_draw_summary(300)

func _draw_summary(y0: float) -> void:
	var font := ThemeDB.fallback_font
	var acc := _accuracy_pct()
	var lines := [
		"score: %d" % _score,
		"combo: %d" % _combo,
		"accuracy: %.0f%%" % acc,
		"grade: %s" % _grade_letter(),
		"Perfect: %d" % _counts.Perfect,
		"Great: %d" % _counts.Great,
		"Good: %d" % _counts.Good,
		"Miss: %d" % _counts.Miss,
	]
	var y := y0
	for line in lines:
		draw_string(font, Vector2(460, y), line, HORIZONTAL_ALIGNMENT_LEFT, -1, 26, Color(0.92, 0.92, 1))
		y += 34

func _blit_arrow(lane: int, pos: Vector2, scale: float) -> void:
	if lane < 0 or lane >= _tex.size() or _tex[lane] == null:
		draw_rect(Rect2(pos, Vector2(64, 64) * scale), Color(0.6, 0.6, 0.7))
		return
	var tex: Texture2D = _tex[lane]
	var size := Vector2(tex.get_width(), tex.get_height()) * scale
	draw_texture_rect(tex, Rect2(pos, size), false)
