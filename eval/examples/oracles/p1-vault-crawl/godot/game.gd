extends Node2D

var phase: String = "play"
var px: int = 1
var py: int = 1
var hasKey: bool = false
var doorOpen: bool = false
var bx: int = 3
var by: int = 2
var ex: int = 2
var ey: int = 3
var patrol: int = 0
var tick: int = 0

const W := 8
const H := 6
const CELL := 80
const OX := 320
const OY := 120
var wall_tex: Texture2D
var floor_tex: Texture2D
var door_tex: Texture2D
var door_open_tex: Texture2D
var chest_tex: Texture2D
var key_tex: Texture2D
var player_tex: Texture2D
var guard_tex: Texture2D

func _ready() -> void:
	wall_tex = load("res://assets/wall.png")
	floor_tex = load("res://assets/floor.png")
	door_tex = load("res://assets/door.png")
	door_open_tex = load("res://assets/door-open.png")
	chest_tex = load("res://assets/chest.png")
	key_tex = load("res://assets/key.png")
	player_tex = load("res://assets/player.png")
	guard_tex = load("res://assets/guard.png")

const MAP := [
	"########",
	"#P..K..#",
	"#..B...#",
	"#.E...D#",
	"#....A.#",
	"#...G..#",
]
const PATROL_X := [1, 2, 3, 2]

func _tile(x: int, y: int) -> String:
	if y < 0 or y >= MAP.size():
		return "#"
	var row := str(MAP[y])
	if x < 0 or x >= row.length():
		return "#"
	return row.substr(x, 1)

func _blocked(x: int, y: int) -> bool:
	if x < 0 or y < 0 or x >= W or y >= H:
		return true
	var t := _tile(x, y)
	if t == "#":
		return true
	if t == "D" and not doorOpen:
		return true
	if bx == x and by == y:
		return true
	return false

func _try_move(dx: int, dy: int) -> void:
	if phase != "play":
		return
	var nx := px + dx
	var ny := py + dy
	if bx == nx and by == ny:
		var tx := bx + dx
		var ty := by + dy
		if _blocked(tx, ty) or (ex == tx and ey == ty):
			return
		bx = tx
		by = ty
	if _blocked(nx, ny):
		return
	px = nx
	py = ny
	if _tile(nx, ny) == "K":
		hasKey = true
		doorOpen = true
	if _tile(nx, ny) == "A":
		phase = "fail"
	if _tile(nx, ny) == "G" and hasKey:
		phase = "clear"
	if px == ex and py == ey:
		phase = "fail"
	queue_redraw()

func _process(dt: float) -> void:
	var step := int(round(dt * 1000.0))
	if step <= 0 or phase != "play":
		return
	tick += step
	if tick >= 792:
		tick = 0
		patrol = (patrol + 1) % PATROL_X.size()
		ex = int(PATROL_X[patrol])
		ey = 3
		if px == ex and py == ey:
			phase = "fail"
	queue_redraw()

func _input(event) -> void:
	if event is InputEventKey and event.pressed and not event.echo:
		if event.keycode == KEY_LEFT or event.keycode == KEY_A:
			_try_move(-1, 0)
		elif event.keycode == KEY_RIGHT or event.keycode == KEY_D:
			_try_move(1, 0)
		elif event.keycode == KEY_UP or event.keycode == KEY_W:
			_try_move(0, -1)
		elif event.keycode == KEY_DOWN or event.keycode == KEY_S:
			_try_move(0, 1)

func _draw() -> void:
	draw_rect(Rect2(0, 0, 1280, 720), Color("020617"))
	draw_string(ThemeDB.fallback_font, Vector2(40, 52), "Vault Crawl", HORIZONTAL_ALIGNMENT_LEFT, 1200, 40, Color("e2e8f0"))
	var hud := "phase=%s pos=%s,%s key=%s door=%s box=%s,%s guard=%s,%s" % [phase, px, py, 1 if hasKey else 0, 1 if doorOpen else 0, bx, by, ex, ey]
	draw_string(ThemeDB.fallback_font, Vector2(40, 100), hud, HORIZONTAL_ALIGNMENT_LEFT, 1200, 22, Color("cbd5e1"))
	for y in H:
		for x in W:
			var t := _tile(x, y)
			var c := Color("0f172a")
			if t == "#":
				c = Color("1e293b")
			elif t == "A":
				c = Color("7f1d1d")
			elif t == "G":
				c = Color("166534")
			elif t == "D":
				c = Color("854d0e") if doorOpen else Color("44403c")
			elif t == "K":
				c = Color("334155") if hasKey else Color("ca8a04")
			draw_rect(Rect2(OX + x * CELL, OY + y * CELL, CELL - 4, CELL - 4), c)
			var ground: Texture2D = wall_tex if t == "#" else floor_tex
			if ground:
				draw_texture_rect(ground, Rect2(OX + x * CELL, OY + y * CELL, CELL - 4, CELL - 4), false)
			if t == "D":
				var door: Texture2D = door_open_tex if doorOpen else door_tex
				if door:
					draw_texture_rect(door, Rect2(OX + x * CELL, OY + y * CELL, CELL - 4, CELL - 4), false)
			if t == "K" and not hasKey and key_tex:
				draw_texture_rect(key_tex, Rect2(OX + x * CELL + 12, OY + y * CELL + 12, 52, 52), false)
	if chest_tex:
		draw_texture_rect(chest_tex, Rect2(OX + bx * CELL + 8, OY + by * CELL + 8, 60, 60), false)
	if guard_tex:
		draw_texture_rect(guard_tex, Rect2(OX + ex * CELL + 8, OY + ey * CELL + 8, 60, 60), false)
	if player_tex:
		draw_texture_rect(player_tex, Rect2(OX + px * CELL + 8, OY + py * CELL + 8, 60, 60), false)
	if phase == "fail":
		draw_string(ThemeDB.fallback_font, Vector2(40, 680), "Caught", HORIZONTAL_ALIGNMENT_CENTER, 1200, 40, Color("fecaca"))
	if phase == "clear":
		draw_string(ThemeDB.fallback_font, Vector2(40, 680), "Vault open", HORIZONTAL_ALIGNMENT_CENTER, 1200, 40, Color("bbf7d0"))
