import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { FRAME_MS, REPLAY_FPS, stillPlayMeta } from '../src/p1-trace.mjs';
import { checkOnegameBoot, traceEventArgv } from '../src/p1-onegame.mjs';
import { runOnegameCli } from '../src/onegame-cli.mjs';
import { parseCliJson, readStoreState } from '../src/util.mjs';
import { godotBin, makeTraceJob, runGodotJob, stageGodotProject } from '../src/p1-godot.mjs';
import { WORK_DIR } from '../src/paths.mjs';

test('submitted frames use the same exact 30fps clock in both adapters', () => {
  assert.ok(Math.abs(FRAME_MS * REPLAY_FPS - 1000) < 1e-10);
  assert.equal(stillPlayMeta({ id: 'loop_f299' }).t_ms, 10000);
  assert.equal(makeTraceJob({ traces: [] }).frame_dt * 300, 10);
});

test('trace clicks are instantaneous, unlike the CLI default click macro', () => {
  const argv = traceEventArgv('out/eval.1gamerecord', { type: 'click', x: 640, y: 225 });
  assert.equal(argv[argv.indexOf('--ms') + 1], '0');
  assert.deepEqual(JSON.parse(argv[argv.indexOf('--event') + 1]), {
    type: 'click', data: { x: 640, y: 225, ms: 0 },
  });
});

test('1Game click and 300 fractional frame ticks consume exactly ten seconds', {
  skip: !process.env.EVAL_TEST_ONEGAME_WORKSPACE ? 'Set EVAL_TEST_ONEGAME_WORKSPACE to a pinned installation' : false,
}, () => {
  fs.mkdirSync(WORK_DIR, { recursive: true });
  const dir = fs.mkdtempSync(path.join(WORK_DIR, 'trace-onegame-'));
  const installation = path.resolve(process.env.EVAL_TEST_ONEGAME_WORKSPACE);
  for (const name of ['package.json', 'tsconfig.json', '1game.config.ts']) {
    fs.copyFileSync(path.join(installation, name), path.join(dir, name));
  }
  fs.symlinkSync(path.join(installation, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src/game.tsx'), `import { createGameStore, renderGame, useFrame } from '@1game/engine-bundle/runtime/worker';
const { store, commitChange, bindStore } = createGameStore({ elapsed: 0, clicks: 0 });
function Game() {
  useFrame(f => { if (f.deltaSeconds > 0) commitChange('tick', d => { d.elapsed += f.deltaSeconds; }); });
  return <scene width={1280} height={720} backgroundColor="#182838">
    <node x={470} y={183} width={340} height={86} clickable backgroundColor="#50d0a0" onClick={() => commitChange('click', d => { d.clicks++; })} />
  </scene>;
}
renderGame(() => <Game />, { bindStore });
`);
  const record = 'out/eval.1gamerecord';
  function state() {
    const proc = runOnegameCli(dir, ['1gameplay', 'frame', 'query', record, '--at', 'last', '--select', 'store:state', '--payload', 'full']);
    assert.equal(proc.status, 0, proc.stderr || proc.stdout);
    return readStoreState(parseCliJson(proc.stdout)).value;
  }
  try {
    const boot = checkOnegameBoot(dir);
    assert.equal(boot.ok, true, boot.notes?.join('\n'));
    const initial = state();
    const click = runOnegameCli(dir, traceEventArgv(record, { type: 'click', x: 640, y: 225 }));
    assert.equal(click.status, 0, click.stderr || click.stdout);
    assert.equal(state().clicks, 1);
    assert.ok(Math.abs(state().elapsed - initial.elapsed) < 1e-9);
    const ticks = runOnegameCli(dir, ['1gameplay', 'step', record, '--ms', String(FRAME_MS), '--repeat', '300']);
    assert.equal(ticks.status, 0, ticks.stderr || ticks.stdout);
    assert.ok(Math.abs(state().elapsed - initial.elapsed - 10) < 1e-8, JSON.stringify(state()));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Godot traces update mouse/key state, dispatch GUI/child input, and freeze capture time', {
  skip: !fs.existsSync(godotBin()) ? 'Godot 4.4.1 is not installed' : false,
}, () => {
  fs.mkdirSync(WORK_DIR, { recursive: true });
  const dir = fs.mkdtempSync(path.join(WORK_DIR, 'trace-runtime-'));
  const source = path.join(dir, 'source');
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, 'project.godot'), `config_version=5
[application]
run/main_scene="res://game.tscn"
[rendering]
renderer/rendering_method="gl_compatibility"
`);
  fs.writeFileSync(path.join(source, 'game.tscn'), `[gd_scene load_steps=3 format=3]
[ext_resource type="Script" path="res://game.gd" id="1"]
[ext_resource type="Script" path="res://child.gd" id="2"]
[node name="Game" type="Node2D"]
script = ExtResource("1")
[node name="Listener" type="Node" parent="."]
script = ExtResource("2")
[node name="Button" type="Button" parent="."]
offset_left = 32.0
offset_top = 80.0
offset_right = 232.0
offset_bottom = 160.0
text = "Click"
`);
  fs.writeFileSync(path.join(source, 'child.gd'), `extends Node
func _input(event):
\tif event is InputEventMouseButton and event.pressed:
\t\tget_parent().child_clicks += 1
func _unhandled_input(event):
\tif event is InputEventKey and event.pressed:
\t\tget_parent().unhandled_keys += 1
`);
  fs.writeFileSync(path.join(source, 'game.gd'), `extends Node2D
var tick_count := 0
var elapsed := 0.0
var root_clicks := 0
var child_clicks := 0
var gui_clicks := 0
var unhandled_keys := 0
var mouse_in_rect := false
var key_down_seen := false
var key_up_seen := false
var initial_key_down := false
func _ready():
\tinitial_key_down = Input.is_key_pressed(KEY_A)
\t$Button.pressed.connect(func(): gui_clicks += 1)
func _process(delta):
\ttick_count += 1
\telapsed += delta
func _input(event):
\tif event is InputEventMouseButton and event.pressed:
\t\troot_clicks += 1
\t\tif root_clicks == 1:
\t\t\tmouse_in_rect = Rect2(470, 183, 340, 86).has_point(get_global_mouse_position())
\tif event is InputEventKey and event.keycode == KEY_A:
\t\tif event.pressed:
\t\t\tkey_down_seen = Input.is_key_pressed(KEY_A)
\t\telse:
\t\t\tkey_up_seen = not Input.is_key_pressed(KEY_A)
func _draw():
\tdraw_rect(Rect2(0, 0, 1280, 720), Color("182838"))
`);
  try {
    const staged = stageGodotProject({ taskId: 'p1-chart-rush', runId: `${path.basename(dir)}/staged`, srcDir: source });
    assert.equal(staged.tamper, false);
    const trace = {
      schema: 'eval.trace/1', scenario: 'input', duration_frames: 300,
      viewport: { w: 1280, h: 720 },
      events: [
        { frame: 0, type: 'click', x: 640, y: 225 },
        { frame: 1, type: 'keydown', code: 'KeyA' },
        { frame: 2, type: 'keyup', code: 'KeyA' },
        { frame: 3, type: 'click', x: 132, y: 120 },
      ],
    };
    const hold = { ...trace, scenario: 'hold', duration_frames: 1, events: [{ frame: 0, type: 'keydown', code: 'KeyA' }] };
    const reset = { ...trace, scenario: 'reset', duration_frames: 1, events: [] };
    const job = makeTraceJob({ traces: [trace, hold, reset].map((trace) => ({ audit: { ok: true }, trace })), stillsDir: path.join(dir, 'stills'), sampleEvery: 100 });
    job.probe_keys = ['tick_count', 'elapsed', 'root_clicks', 'child_clicks', 'gui_clicks', 'unhandled_keys', 'mouse_in_rect', 'key_down_seen', 'key_up_seen', 'initial_key_down'];
    const result = runGodotJob({ projectDir: staged.dest, job, outPath: path.join(dir, 'events.jsonl') });
    assert.equal(result.ok, true, JSON.stringify(result));
    const final = result.events.find((e) => e.event === 'probe' && e.id === 'input_f299')?.state;
    assert.ok(final, JSON.stringify(result.events));
    assert.equal(final.tick_count, 300);
    assert.ok(Math.abs(final.elapsed - 10) < 1e-8, `elapsed=${final.elapsed}`);
    assert.equal(final.root_clicks, 2, JSON.stringify(final));
    assert.equal(final.child_clicks, 2);
    assert.equal(final.gui_clicks, 1);
    assert.equal(final.unhandled_keys, 1);
    assert.equal(final.mouse_in_rect, true, JSON.stringify(final));
    assert.equal(final.key_down_seen, true);
    assert.equal(final.key_up_seen, true);
    const fresh = result.events.find((e) => e.event === 'probe' && e.id === 'reset_f0')?.state;
    assert.equal(fresh?.initial_key_down, false, JSON.stringify(fresh));
    assert.equal(fresh?.tick_count, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Godot native timers, animation and input edges are independent of capture frequency', {
  skip: !fs.existsSync(godotBin()) ? 'Godot 4.4.1 is not installed' : false,
}, () => {
  fs.mkdirSync(WORK_DIR, { recursive: true });
  const dir = fs.mkdtempSync(path.join(WORK_DIR, 'trace-native-clock-'));
  const source = path.join(dir, 'source');
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, 'project.godot'), `config_version=5
[application]
run/main_scene="res://game.tscn"
[rendering]
renderer/rendering_method="gl_compatibility"
`);
  fs.writeFileSync(path.join(source, 'game.tscn'), `[gd_scene load_steps=3 format=3]
[ext_resource type="Script" path="res://game.gd" id="1"]
[ext_resource type="Script" path="res://disabled.gd" id="2"]
[node name="Game" type="Node2D"]
script = ExtResource("1")
[node name="Disabled" type="Node" parent="."]
process_mode = 4
script = ExtResource("2")
`);
  fs.writeFileSync(path.join(source, 'disabled.gd'), `extends Node
func _process(_delta):
\tget_parent().disabled_ticks += 1
`);
  fs.writeFileSync(path.join(source, 'game.gd'), `extends Node2D
var tick_count := 0
var elapsed := 0.0
var physics_ticks := 0
var disabled_ticks := 0
var timer_fires := 0
var tween_value := 0.0
var animation_value := 0.0
var action_presses := 0
var action_releases := 0
var physics_presses := 0
var initial_key_down := false
var _scene_timer: SceneTreeTimer
var scene_timer_remaining: float:
\tget:
\t\treturn _scene_timer.time_left
func _ready():
\tprocess_mode = Node.PROCESS_MODE_ALWAYS
\tinitial_key_down = Input.is_key_pressed(KEY_ENTER)
\tvar timer := Timer.new()
\ttimer.wait_time = 0.1
\ttimer.timeout.connect(func(): timer_fires += 1)
\tadd_child(timer)
\ttimer.start()
\t_scene_timer = get_tree().create_timer(100.0)
\tcreate_tween().tween_property(self, "tween_value", 1.0, 0.2)
\tvar player := AnimationPlayer.new()
\tvar animation := Animation.new()
\tanimation.length = 0.2
\tvar track := animation.add_track(Animation.TYPE_VALUE)
\tanimation.track_set_path(track, ":animation_value")
\tanimation.track_insert_key(track, 0.0, 0.0)
\tanimation.track_insert_key(track, 0.2, 1.0)
\tvar library := AnimationLibrary.new()
\tlibrary.add_animation("run", animation)
\tplayer.add_animation_library("", library)
\tadd_child(player)
\tplayer.play("run")
func _process(delta):
\ttick_count += 1
\telapsed += delta
\tif Input.is_action_just_pressed("ui_accept"):
\t\taction_presses += 1
\tif Input.is_action_just_released("ui_accept"):
\t\taction_releases += 1
func _physics_process(_delta):
\tphysics_ticks += 1
\tif Input.is_action_just_pressed("ui_accept"):
\t\tphysics_presses += 1
func _draw():
\tdraw_rect(Rect2(0, 0, 1280, 720), Color("182838"))
`);
  try {
    const staged = stageGodotProject({ taskId: 'p1-chart-rush', runId: `${path.basename(dir)}/staged`, srcDir: source });
    const trace = { schema: 'eval.trace/1', scenario: 'loop', duration_frames: 60, viewport: { w: 1280, h: 720 },
      events: [{ frame: 1, type: 'keydown', code: 'Enter' }, { frame: 2, type: 'keyup', code: 'Enter' }] };
    const hold = { ...trace, scenario: 'hold', duration_frames: 1, events: [{ frame: 0, type: 'keydown', code: 'Enter' }] };
    const reset = { ...trace, scenario: 'reset', duration_frames: 1, events: [] };
    let reference;
    for (const { sampleEvery, capture } of [{ sampleEvery: 15, capture: true }, { sampleEvery: 61, capture: true }, { sampleEvery: 15, capture: false }]) {
      const name = `${sampleEvery}-${capture}`;
      const job = makeTraceJob({ traces: [trace, hold, reset].map(trace => ({ audit: { ok: true }, trace })),
        stillsDir: capture ? path.join(dir, `stills-${name}`) : undefined, sampleEvery });
      job.probe_keys = ['tick_count', 'elapsed', 'physics_ticks', 'disabled_ticks', 'timer_fires', 'tween_value', 'animation_value',
        'action_presses', 'action_releases', 'physics_presses', 'initial_key_down', 'scene_timer_remaining'];
      const result = runGodotJob({ projectDir: staged.dest, job, outPath: path.join(dir, `${name}.jsonl`) });
      assert.equal(result.ok, true, JSON.stringify(result));
      const final = result.events.find(e => e.event === 'probe' && e.id === 'loop_f59')?.state;
      assert.ok(final, JSON.stringify(result.events));
      assert.equal(final.tick_count, 60);
      assert.ok(Math.abs(final.elapsed - 2) < 1e-8, JSON.stringify(final));
      assert.equal(final.physics_ticks, 60);
      assert.equal(final.disabled_ticks, 0);
      assert.ok(final.timer_fires >= 19 && final.timer_fires <= 20, JSON.stringify(final));
      assert.equal(final.tween_value, 1);
      assert.equal(final.animation_value, 1);
      assert.equal(final.action_presses, 1);
      assert.equal(final.action_releases, 1);
      assert.equal(final.physics_presses, 1);
      assert.ok(Math.abs(final.scene_timer_remaining - 98) < 1e-8, JSON.stringify(final));
      if (reference) assert.deepEqual(final, reference, `gameplay differs with capture=${capture}, sampleEvery=${sampleEvery}`);
      reference = final;
      if (capture) assert.equal(result.events.filter(e => e.event === 'still').length, sampleEvery === 15 ? 7 : 4);
      const fresh = result.events.find(e => e.event === 'probe' && e.id === 'reset_f0')?.state;
      assert.equal(fresh?.initial_key_down, false, JSON.stringify(fresh));
      assert.equal(fresh?.action_presses, 0);
      assert.equal(fresh?.action_releases, 0);
      assert.equal(fresh?.tick_count, 1);
      assert.equal(fresh?.physics_ticks, 1);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
