"""Build Nooklane maps in code.

A map is a grid of tiles plus things placed on it; it travels as JSON to the
browser (``assets/nooklane/world.js`` draws it and walks on it):

    {
      "v": 1, "w": 40, "h": 28,
      "floor":   ["....,,,,", ...],   # one char per tile, see FLOORS (" " = nothing)
      "walls":   ["####    ", ...],   # one char per tile, see WALLS (" " = none)
      "objects": [{"t": "desk", "x": 3, "y": 4}, {"t": "tv", "x": 9, "y": 2, "url": "..."}],
      "areas":   [{"id": "a1", "name": "Meeting room", "kind": "private",
                   "rects": [[x, y, w, h]]}],
      "spawns":  [[x, y], ...]
    }

Object types and their sizes are listed in OBJECTS (the browser has the same
table, with the drawings). An object covers ``w`` x ``h`` tiles from its top
left tile; a ``solid`` one blocks walking. Area kinds:

* ``private``   - people inside hear and see each other at full strength,
                  and nobody outside hears them (a meeting room, a café table)
* ``spotlight`` - whoever stands here is heard and seen by everyone in the
                  space (a stage)
"""

from __future__ import annotations

import copy
from typing import Any

# Floor kinds by map character.
FLOORS = {
    ".": "wood",
    "d": "darkwood",
    ",": "carpet",
    ";": "rosecarpet",
    "b": "bluecarpet",
    "_": "tile",
    "-": "stone",
    ":": "path",
    '"': "grass",
    "s": "sand",
    "~": "water",
    "=": "stage",
}
# Walls by map character.
WALLS = {
    "#": "wall",
    "w": "window",
    "f": "fence",
    "h": "hedge",
}
# Floors nobody can walk on.
BLOCKING_FLOORS = {" ", "~"}

# type -> (w, h, solid). Must match OBJECTS in assets/nooklane/world.js.
OBJECTS: dict[str, tuple[int, int, bool]] = {
    # furniture
    "desk": (2, 1, True),
    "chair": (1, 1, False),
    "office_chair": (1, 1, False),
    "armchair": (1, 1, False),
    "sofa": (2, 1, False),
    "table_round": (2, 2, True),
    "table_long": (3, 2, True),
    "coffee_table": (2, 1, True),
    "cafe_table": (1, 1, True),
    "bookshelf": (2, 1, True),
    "counter": (1, 1, True),
    "fridge": (1, 1, True),
    "coffee_machine": (1, 1, True),
    "water_cooler": (1, 1, True),
    "vending": (1, 1, True),
    "printer": (1, 1, True),
    "lamp": (1, 1, True),
    "plant": (1, 1, True),
    "big_plant": (1, 1, True),
    "rug": (1, 1, False),  # stretched with w/h
    "podium": (1, 1, True),
    "piano": (2, 1, True),
    "arcade": (1, 1, True),
    "trash": (1, 1, True),
    "painting": (1, 1, False),  # hangs on a wall
    "seat_row": (1, 1, False),  # auditorium seat, stretched with w
    # things to use (press X next to them)
    "whiteboard": (2, 1, True),
    "tv": (2, 1, True),
    "note": (1, 1, True),
    "portal": (1, 1, False),
    # outside
    "tree": (1, 1, True),
    "pine": (1, 1, True),
    "bush": (1, 1, True),
    "flowers": (1, 1, False),
    "bench": (2, 1, False),
    "fountain": (3, 3, True),
    "lamp_post": (1, 1, True),
    "campfire": (1, 1, True),
    "log": (1, 1, False),
    "umbrella": (1, 1, True),
    "rock": (1, 1, True),
    "picnic_table": (2, 2, True),
}
# Objects that can be used with X, and what they need.
INTERACTIVE = {"whiteboard", "tv", "note", "portal", "arcade", "piano"}


class MapBuilder:
    """Draws a map tile by tile; ``to_json()`` gives the map dict."""

    def __init__(self, w: int, h: int, floor: str = " "):
        self.w = w
        self.h = h
        self.floor = [[floor] * w for _ in range(h)]
        self.walls = [[" "] * w for _ in range(h)]
        self.objects: list[dict[str, Any]] = []
        self.areas: list[dict[str, Any]] = []
        self.spawns: list[list[int]] = []

    # --- tiles ------------------------------------------------------------------

    def _inside(self, x: int, y: int) -> bool:
        return 0 <= x < self.w and 0 <= y < self.h

    def fill(self, x: int, y: int, w: int, h: int, floor: str) -> MapBuilder:
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                if self._inside(xx, yy):
                    self.floor[yy][xx] = floor
        return self

    def wall(self, x: int, y: int, w: int = 1, h: int = 1, kind: str = "#") -> MapBuilder:
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                if self._inside(xx, yy):
                    self.walls[yy][xx] = kind
        return self

    def clear_wall(self, x: int, y: int, w: int = 1, h: int = 1) -> MapBuilder:
        return self.wall(x, y, w, h, " ")

    def room(
        self,
        x: int,
        y: int,
        w: int,
        h: int,
        floor: str = ".",
        wall: str = "#",
        doors: tuple[tuple[str, int, int], ...] = (),
        windows: tuple[tuple[str, int, int], ...] = (),
    ) -> MapBuilder:
        """A walled room; ``x, y, w, h`` include the walls.

        ``doors`` / ``windows``: ``(side, offset, width)`` with side one of
        ``n s w e`` and offset counted from the room's left / top wall tile.
        """
        self.fill(x + 1, y + 1, w - 2, h - 2, floor)
        self.wall(x, y, w, 1, wall)
        self.wall(x, y + h - 1, w, 1, wall)
        self.wall(x, y, 1, h, wall)
        self.wall(x + w - 1, y, 1, h, wall)
        for side, offset, width in windows:
            self._opening(x, y, w, h, side, offset, width, "w")
        for side, offset, width in doors:
            self._opening(x, y, w, h, side, offset, width, None)
        return self

    def _opening(self, x, y, w, h, side, offset, width, kind):  # noqa: ANN001
        cells = {
            "n": [(x + offset + i, y) for i in range(width)],
            "s": [(x + offset + i, y + h - 1) for i in range(width)],
            "w": [(x, y + offset + i) for i in range(width)],
            "e": [(x + w - 1, y + offset + i) for i in range(width)],
        }[side]
        for cx, cy in cells:
            if not self._inside(cx, cy):
                continue
            if kind is None:
                self.walls[cy][cx] = " "
                if self.floor[cy][cx] in BLOCKING_FLOORS:
                    # A doorway gets the floor of the room it leads into.
                    inner = {"n": (cx, cy + 1), "s": (cx, cy - 1), "w": (cx + 1, cy), "e": (cx - 1, cy)}[side]
                    self.floor[cy][cx] = self.floor[inner[1]][inner[0]]
            else:
                self.walls[cy][cx] = kind

    # --- things -------------------------------------------------------------------

    def add(self, t: str, x: int, y: int, **props: Any) -> MapBuilder:
        if t not in OBJECTS:
            msg = f"unknown object type {t!r}"
            raise ValueError(msg)
        obj = {"t": t, "x": x, "y": y}
        obj.update({k: v for k, v in props.items() if v is not None})
        self.objects.append(obj)
        return self

    def area(self, name: str, kind: str, x: int, y: int, w: int, h: int, *more: tuple[int, int, int, int]) -> MapBuilder:
        rects = [[x, y, w, h], *[list(r) for r in more]]
        self.areas.append({"id": f"a{len(self.areas) + 1}", "name": name, "kind": kind, "rects": rects})
        return self

    def spawn(self, x: int, y: int, w: int = 1, h: int = 1) -> MapBuilder:
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                self.spawns.append([xx, yy])
        return self

    # --- result ------------------------------------------------------------------

    def to_json(self) -> dict[str, Any]:
        data = {
            "v": 1,
            "w": self.w,
            "h": self.h,
            "floor": ["".join(row) for row in self.floor],
            "walls": ["".join(row) for row in self.walls],
            "objects": copy.deepcopy(self.objects),
            "areas": copy.deepcopy(self.areas),
            "spawns": copy.deepcopy(self.spawns),
        }
        problems = validate(data)
        if problems:
            raise ValueError("invalid map: " + "; ".join(problems[:5]))
        return data


def solid_tiles(data: dict[str, Any]) -> set[tuple[int, int]]:
    """Tiles nobody can stand on: nothing / water, walls, solid objects."""
    blocked: set[tuple[int, int]] = set()
    for y, row in enumerate(data["floor"]):
        for x, ch in enumerate(row):
            if ch in BLOCKING_FLOORS or data["walls"][y][x] != " ":
                blocked.add((x, y))
    for obj in data["objects"]:
        w0, h0, solid = OBJECTS.get(obj["t"], (1, 1, False))
        if not solid:
            continue
        for yy in range(obj["y"], obj["y"] + int(obj.get("h", h0))):
            for xx in range(obj["x"], obj["x"] + int(obj.get("w", w0))):
                blocked.add((xx, yy))
    return blocked


def validate(data: Any) -> list[str]:
    """What is wrong with a map (empty when it can be used).

    Checks the shape, the characters, the objects' types and positions, the
    areas, and that every spawn point is free and reaches most of the map.
    """
    problems: list[str] = []
    if not isinstance(data, dict):
        return ["not an object"]
    w, h = data.get("w"), data.get("h")
    if not (isinstance(w, int) and isinstance(h, int) and 4 <= w <= 160 and 4 <= h <= 160):
        return ["size must be 4..160 x 4..160"]
    for layer, legal in (("floor", set(FLOORS) | {" "}), ("walls", set(WALLS) | {" "})):
        rows = data.get(layer)
        if not (isinstance(rows, list) and len(rows) == h and all(isinstance(r, str) and len(r) == w for r in rows)):
            problems.append(f"{layer} must be {h} rows of {w} characters")
            continue
        bad = {ch for row in rows for ch in row} - legal
        if bad:
            problems.append(f"{layer} has unknown characters {sorted(bad)}")
    objects = data.get("objects")
    if not isinstance(objects, list) or len(objects) > 4000:
        problems.append("objects must be a list (at most 4000)")
        objects = []
    for obj in objects:
        if not isinstance(obj, dict) or obj.get("t") not in OBJECTS:
            problems.append(f"unknown object {obj!r:.60}")
            continue
        x, y = obj.get("x"), obj.get("y")
        if not (isinstance(x, int) and isinstance(y, int) and 0 <= x < w and 0 <= y < h):
            problems.append(f"{obj['t']} outside the map")
    areas = data.get("areas")
    if not isinstance(areas, list):
        problems.append("areas must be a list")
        areas = []
    for area in areas:
        if not (isinstance(area, dict) and area.get("kind") in ("private", "spotlight")
                and isinstance(area.get("rects"), list) and area["rects"]):
            problems.append(f"bad area {area!r:.60}")
            continue
        for rect in area["rects"]:
            if not (isinstance(rect, list) and len(rect) == 4 and all(isinstance(v, int) for v in rect)
                    and rect[2] > 0 and rect[3] > 0):
                problems.append(f"bad rect in area {area.get('name')!r}")
    spawns = data.get("spawns")
    if not (isinstance(spawns, list) and spawns):
        problems.append("at least one spawn point is needed")
        return problems
    if problems:
        return problems
    blocked = solid_tiles(data)
    for sx, sy in spawns:
        if (sx, sy) in blocked or not (0 <= sx < w and 0 <= sy < h):
            problems.append(f"spawn point {sx},{sy} is blocked")
    return problems


def reachable(data: dict[str, Any], start: tuple[int, int]) -> set[tuple[int, int]]:
    """Tiles one can walk to from ``start`` (4 directions)."""
    blocked = solid_tiles(data)
    seen = {start}
    todo = [start]
    while todo:
        x, y = todo.pop()
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < data["w"] and 0 <= ny < data["h"] and (nx, ny) not in blocked and (nx, ny) not in seen:
                seen.add((nx, ny))
                todo.append((nx, ny))
    return seen
