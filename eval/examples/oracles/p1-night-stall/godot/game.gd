extends Node2D

var phase: String = "title"
var clockMs: int = 0
var station: int = 0
var cooking: int = 0
var cookStation: int = 0
var cooked: int = -1
var served: int = 0
var coins: int = 0
var upgrade: int = 0
var waiting: int = -1
var spawned: int = 0

const GUEST_AT := [2000, 5000, 8000, 11000]
const WANT := [0, 1, 2, 0]
const COOK := [330, 660, 330]
const PATIENCE := 2700
const CLOSE_AT := 15000
const NAMES := ["Bun", "Noodle", "Tea"]

func _cook_ms(st: int) -> int:
	var raw: int = COOK[st]
	if upgrade == 1:
		return int(raw / 2)
	return raw

func _open() -> void:
	if phase != "title":
		return
	phase = "open"
	clockMs = 0

func _process(dt: float) -> void:
	var step := int(round(dt * 1000.0))
	if step <= 0 or phase != "open":
		queue_redraw()
		return
	clockMs += step
	if cooking > 0:
		cooking = maxi(0, cooking - step)
		if cooking == 0:
			cooked = cookStation
	while spawned < GUEST_AT.size() and clockMs >= int(GUEST_AT[spawned]):
		if waiting < 0:
			waiting = spawned
		spawned += 1
	if waiting >= 0 and clockMs - int(GUEST_AT[waiting]) > PATIENCE:
		phase = "fail"
	elif clockMs >= CLOSE_AT:
		phase = "clear" if served >= 3 else "fail"
	queue_redraw()

func _input(event) -> void:
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		var p = event.position
		if p.x >= 840 and p.x < 1200 and p.y >= 430 and p.y < 550:
			_open()
	if event is InputEventKey and event.pressed and not event.echo:
		if event.keycode == KEY_ENTER:
			_open()
		if phase != "open":
			queue_redraw()
			return
		if event.keycode == KEY_LEFT:
			station = maxi(0, station - 1)
		if event.keycode == KEY_RIGHT:
			station = mini(2, station + 1)
		if event.keycode == KEY_UP and coins >= 1 and upgrade == 0:
			coins -= 1
			upgrade = 1
		if event.keycode == KEY_SPACE:
			if cooking > 0:
				return
			if cooked >= 0:
				if waiting >= 0 and int(WANT[waiting]) == cooked:
					served += 1
					coins += 1
					cooked = -1
					waiting += 1
					if waiting >= spawned:
						waiting = -1
				elif waiting >= 0:
					phase = "fail"
				else:
					cooked = -1
			else:
				cookStation = station
				cooking = _cook_ms(station)
	queue_redraw()

func _draw() -> void:
	draw_rect(Rect2(0, 0, 1280, 720), Color("1c0b12"))
	draw_string(ThemeDB.fallback_font, Vector2(40, 52), "Night Stall", HORIZONTAL_ALIGNMENT_LEFT, 1200, 40, Color("fecdd3"))
	var dish := "empty" if cooked < 0 else str(NAMES[cooked])
	var want := "none" if waiting < 0 else str(NAMES[int(WANT[waiting])])
	var hud := "phase=%s clockMs=%s station=%s cooked=%s served=%s coins=%s upgrade=%s want=%s" % [phase, clockMs, NAMES[station], dish, served, coins, upgrade, want]
	draw_string(ThemeDB.fallback_font, Vector2(40, 100), hud, HORIZONTAL_ALIGNMENT_LEFT, 1200, 22, Color("ffe4e6"))
	var cols := [Color("fb7185"), Color("fbbf24"), Color("38bdf8")]
	for i in 3:
		var c: Color = cols[i] if station == i else Color("4c0519")
		draw_rect(Rect2(80 + i * 420, 160, 280, 220), c)
		draw_string(ThemeDB.fallback_font, Vector2(80 + i * 420, 280), str(NAMES[i]), HORIZONTAL_ALIGNMENT_CENTER, 280, 40, Color("fff1f2"))
	draw_rect(Rect2(80, 420, 360, 120), Color("e11d48") if waiting >= 0 else Color("3f3f46"))
	draw_string(ThemeDB.fallback_font, Vector2(80, 490), "Guest %s" % want if waiting >= 0 else "Queue empty", HORIZONTAL_ALIGNMENT_CENTER, 360, 32, Color.WHITE)
	draw_rect(Rect2(480, 420, 280, 120), Color("a3e635") if upgrade == 1 else Color("44403c"))
	draw_string(ThemeDB.fallback_font, Vector2(480, 490), "Upgrade", HORIZONTAL_ALIGNMENT_CENTER, 280, 32, Color.WHITE)
	if phase == "title":
		draw_rect(Rect2(840, 430, 360, 120), Color("881337"))
		draw_string(ThemeDB.fallback_font, Vector2(840, 500), "Start", HORIZONTAL_ALIGNMENT_CENTER, 360, 36, Color("fff7ed"))
	if phase == "fail":
		draw_string(ThemeDB.fallback_font, Vector2(40, 640), "Closed early", HORIZONTAL_ALIGNMENT_CENTER, 1200, 48, Color("fecaca"))
	if phase == "clear":
		draw_string(ThemeDB.fallback_font, Vector2(40, 640), "Night clear", HORIZONTAL_ALIGNMENT_CENTER, 1200, 48, Color("bbf7d0"))
