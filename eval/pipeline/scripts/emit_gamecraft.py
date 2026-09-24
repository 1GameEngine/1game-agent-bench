#!/usr/bin/env python3
"""Emit GameCraft P1 tasks, hidden rubrics, and submitted traces."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TASKS = ROOT / "tasks"
ORACLES = ROOT / "examples" / "oracles"

CONSTRAINT = """
## 实现约束

- 画面逻辑尺寸 1280×720，恰好一个场景。
- 禁止随机。禁止用物理引擎决定对错。
- 不要实现评测探测接口。不要读取评测仓、量表或官方操作表。
- 提交物须含可重放 traces（放在 demo_outputs，每条标明 intro / loop / fail / clear 之一）。
""".strip()

PROJECT = """config_version=5

[application]
config/name="{name}"
run/main_scene="res://game.tscn"
config/features=PackedStringArray("4.4")

[display]
window/size/viewport_width=1280
window/size/viewport_height=720
window/stretch/mode="disabled"

[rendering]
renderer/rendering_method="gl_compatibility"
"""

TSCN = """[gd_scene load_steps=2 format=3 uid="uid://eval{short}"]

[ext_resource type="Script" path="res://game.gd" id="1_game"]

[node name="Game" type="Node2D"]
script = ExtResource("1_game")
"""

FORMULA = "G * (15*M + 35*D + 15*V + 35*A)"


def tap(frame: int, code: str) -> list[dict]:
    return [
        {"frame": frame, "type": "keydown", "code": code},
        {"frame": frame + 1, "type": "keyup", "code": code},
    ]


def trace(scenario: str, duration: int, events: list[dict]) -> dict:
    events = sorted(events, key=lambda e: (e["frame"], e["type"]))
    return {
        "schema": "eval.trace/1",
        "scenario": scenario,
        "duration_frames": duration,
        "viewport": {"w": 1280, "h": 720},
        "events": events,
    }


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def write_traces(task_id: str, traces: list[dict]) -> None:
    names = ["01_intro.json", "02_loop.json", "03_fail.json", "04_clear.json"]
    for engine in ("onegame", "godot"):
        d = ORACLES / task_id / engine / "demo_outputs"
        d.mkdir(parents=True, exist_ok=True)
        for name, tr in zip(names, traces):
            write_json(d / name, tr)


def task_yaml(task_id: str) -> str:
    return f"""id: {task_id}
tier: P1
entry: src/game.tsx
scene:
  count: 1
  width: 1280
  height: 720
rng: forbidden
physics: forbidden
judge: rubric_replay
traces: submitted
replay_fps: 30
"""


def req(rid: str, text: str) -> dict:
    return {"id": rid, "description": text}


NIGHT = {
    "id": "p1-night-stall",
    "title": "夜市摊",
    "instruction": """# 夜市摊

做一个 1280×720 的夜市摊经营小游戏，标题文案必须是 Night Stall。

## 开局

- 标题阶段。画面有按钮 Start（矩形 x=840 y=430 w=360 h=120）。按 Enter 或点 Start 开档。
- 三种商品档位从左到右固定文案 Bun / Noodle / Tea，矩形分别是 (80,160,280,220)、(500,160,280,220)、(920,160,280,220)。
- 还有 Upgrade 区 (480,420,280,120) 与客人队列区 (80,420,360,120)。

## 规则（确定性，禁止随机）

- 开档后内部时钟从 0 起算。客人分别在 2000、5000、8000、11000 毫秒到达，点单循环为 Bun、Noodle、Tea、Bun。每位客人只等 2700 毫秒。
- 左右方向键切换当前档位。空格：档位空闲则开始制作（Bun 330ms、Noodle 660ms、Tea 330ms）；手上有成品且队首点单匹配则出餐（served 与 coins 各加 1）；队首点单不匹配则失败。
- 上方向键：若 coins≥1 且尚未升级，花 1 枚硬币升级，制作时间减半。
- 15000 毫秒打烊：served≥3 通关（画面 Night clear），否则失败（Closed early）。超时未出餐同样失败。

## 验收会看的玩法

开局静止、正常出餐循环、失败（错餐或超时）、打烊通关。
""",
    "rubric": [
        req("M1", "标题阶段可见 Night Stall 与 Start，未开档时客人未入座。"),
        req("M2", "三种档位文案是 Bun / Noodle / Tea，可用左右键切换当前档。"),
        req("M3", "开档后客人按固定时刻入队，点单循环可见。"),
        req("M4", "匹配出餐会增加 served/coins；错餐或超时会失败。"),
        req("M5", "打烊后通关或失败文案出现，且与出餐数量一致。"),
        req("D1", "备餐与出餐是两段动作，不是按一下就结算。"),
        req("D2", "Upgrade 与三种商品在画面上可区分，升级后节奏应能变。"),
        req("V1", "三档位、队列、Start/Upgrade 都在指定区域且文案正确。"),
        req("V2", "状态条能读出 phase、clock、档位、cooked、served。"),
        req("V3", "当前客人点单或空队列从画面能看出来。"),
        req("A1", "夜市暖色风格统一，不是灰默认调试屏。"),
        req("A2", "档位/食物有形状或配色差异，不只一行数字。"),
    ],
}

VAULT = {
    "id": "p1-vault-crawl",
    "title": "金库爬行",
    "instruction": """# 金库爬行

做一个 1280×720 的格子探索小游戏，标题文案必须是 Vault Crawl。不要用物理碰撞体做对错。

## 地图

- 8 列 × 6 行格子。原点附近格子像素约 80，棋盘放在画面中部。
- 固定地形（# 墙，P 出生，K 钥匙，B 箱子，E 守卫，D 门，A 警报，G 出口）：

```
########
#P..K..#
#..B...#
#.E...D#
#....A.#
#...G..#
```

## 规则

- 方向键或 WASD 一次移动一格。不能走进墙。未拿钥匙时门挡住。
- 走到钥匙格获得钥匙，门打开。
- 走到箱子格且箱子前方是空地则可推动箱子。
- 守卫在第 4 行（下标 3）的 x=1,2,3,2 循环，约每 792ms 前进一步。碰到守卫或警报格失败，画面 Caught。
- 拿着钥匙走到出口通关，画面 Vault open。

## 验收会看的玩法

开局站在出生点、取钥匙的循环、踩警报失败、取钥匙后走到出口通关。
""",
    "rubric": [
        req("M1", "开局玩家在钥匙左侧的出生格，地图墙与出口可辨。"),
        req("M2", "方向键一次一格，不能穿墙。"),
        req("M3", "拿到钥匙后门的外观或可通过性改变。"),
        req("M4", "箱子可被推到空地，不能推进墙里。"),
        req("M5", "守卫按固定路线移动；碰到守卫或警报会失败。"),
        req("M6", "持钥匙到达出口通关。"),
        req("D1", "钥匙、箱子、守卫、警报、出口在画面上职责不同。"),
        req("D2", "失败与通关是不同结局画面，不是同一句 HUD。"),
        req("V1", "棋盘约在画面中部，格子可数。"),
        req("V2", "HUD 能读出位置、是否持钥匙、守卫位置。"),
        req("A1", "地牢/金库配色统一。"),
        req("A2", "玩家、守卫、箱子不是三个无法分辨的色块克隆。"),
    ],
}

CHART = {
    "id": "p1-chart-rush",
    "title": "谱面冲刺",
    "instruction": """# 谱面冲刺

做一个 1280×720 的四轨节奏小游戏，标题文案必须是 Chart Rush。禁止随机生成谱面。

## 开局

- 按钮 Start 矩形 (440,200,400,120)。点 Start 或按 Enter 开始。
- 开始后倒计时 3000 毫秒，然后进入 playing。

## 谱面

- 四轨按键固定为 ArrowLeft / ArrowDown / ArrowUp / ArrowRight，轨道从左到右。
- 16 个音符：第 i 个（从 0 计）在 playing 后 400×(i+1) 毫秒落到第 i%4 轨。
- 判定窗 ±132 毫秒。命中 hits+1 并消费该音符；错过窗或打错轨 misses+1。
- misses≥6 失败，画面 Chart miss。16 个音符结束后 hits≥12 通关，画面 Chart clear。

## 验收会看的玩法

未开始的标题、打中前几个音的循环、空放漏击失败、打完通关。
""",
    "rubric": [
        req("M1", "未开始时有 Chart Rush 与 Start；倒计时 3000ms 后才进入谱面。"),
        req("M2", "四轨键位与轨道左右顺序一致。"),
        req("M3", "音符按固定谱面下落，不是随机。"),
        req("M4", "窗内打对轨会 hits+1；错过或打错会 misses+1。"),
        req("M5", "漏击过多失败，打完且命中足够则通关。"),
        req("D1", "倒计时、游玩、失败、通关四种阶段外观可分。"),
        req("D2", "16 音长度与四轨同时存在，不是单键单音玩具。"),
        req("V1", "四轨在画面下方排开，Start 在指定矩形。"),
        req("V2", "打谱中轨道中段能看见正在下落的音符。空场或音符钉死在判定条上记 0。"),
        req("A1", "夜店/谱面风格统一。"),
        req("A2", "音符有下落或接近判定线的图形，不只数字加一。"),
    ],
}


def night_traces() -> list[dict]:
    loop = []
    loop += tap(0, "Enter")
    loop += tap(3, "Space")
    loop += tap(64, "Space")
    loop += tap(68, "ArrowRight")
    loop += tap(72, "Space")
    loop += tap(155, "Space")
    fail = []
    fail += tap(0, "Enter")
    fail += tap(3, "ArrowRight")
    fail += tap(6, "ArrowRight")
    fail += tap(9, "Space")
    fail += tap(70, "Space")
    clear = []
    clear += tap(0, "Enter")
    clear += tap(3, "Space")
    clear += tap(64, "Space")
    clear += tap(68, "ArrowUp")
    clear += tap(72, "ArrowRight")
    clear += tap(76, "Space")
    clear += tap(155, "Space")
    clear += tap(160, "ArrowRight")
    clear += tap(164, "Space")
    clear += tap(250, "Space")
    clear += tap(255, "ArrowLeft")
    clear += tap(259, "ArrowLeft")
    clear += tap(263, "Space")
    clear += tap(340, "Space")
    return [
        trace("intro", 45, []),
        trace("loop", 180, loop),
        trace("fail", 90, fail),
        trace("clear", 460, clear),
    ]


def vault_traces() -> list[dict]:
    loop = []
    for i, f in enumerate([2, 8, 14]):
        loop += tap(f, "ArrowRight")
    fail = []
    for f in [2, 8, 14, 20]:
        fail += tap(f, "ArrowRight")
    for f in [26, 32, 38]:
        fail += tap(f, "ArrowDown")
    clear = []
    for f in [2, 8, 14]:
        clear += tap(f, "ArrowRight")
    for f in [20, 26, 32, 38]:
        clear += tap(f, "ArrowDown")
    return [
        trace("intro", 40, []),
        trace("loop", 40, loop),
        trace("fail", 50, fail),
        trace("clear", 55, clear),
    ]


def chart_traces() -> list[dict]:
    lanes = ["ArrowLeft", "ArrowDown", "ArrowUp", "ArrowRight"]
    start = 91

    def hits(n: int) -> list[dict]:
        ev = tap(0, "Enter")
        for i in range(n):
            t_ms = 400 * (i + 1)
            fr = start + int(round(t_ms / 33))
            ev += tap(fr, lanes[i % 4])
        return ev

    return [
        trace("intro", 40, []),
        trace("loop", 160, hits(4)),
        trace("fail", 180, tap(0, "Enter")),
        trace("clear", 310, hits(16)),
    ]


def emit_game(spec: dict, traces: list[dict]) -> None:
    tid = spec["id"]
    tdir = TASKS / tid
    tdir.mkdir(parents=True, exist_ok=True)
    (tdir / "task.yaml").write_text(task_yaml(tid), encoding="utf-8")
    (tdir / "instruction.md").write_text(spec["instruction"].strip() + "\n\n" + CONSTRAINT + "\n", encoding="utf-8")
    write_traces(tid, traces)
    for engine_short in ("nightstall", "vaultcrawl", "chartrush"):
        pass
    short = tid.replace("p1-", "").replace("-", "")
    gdir = ORACLES / tid / "godot"
    gdir.mkdir(parents=True, exist_ok=True)
    (gdir / "project.godot").write_text(PROJECT.format(name=tid), encoding="utf-8")
    (gdir / "game.tscn").write_text(TSCN.format(short=short), encoding="utf-8")


def main() -> None:
    emit_game(NIGHT, night_traces())
    emit_game(VAULT, vault_traces())
    emit_game(CHART, chart_traces())
    print("emitted night-stall vault-crawl chart-rush")


if __name__ == "__main__":
    main()
