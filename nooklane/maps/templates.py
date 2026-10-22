"""The ready-made places a new space can start from.

Each template is a function that builds its map with ``MapBuilder``; ``TEMPLATES``
lists them with their names and descriptions in English and 繁體中文.
"""

from __future__ import annotations

from typing import Any, Callable

from nooklane.maps.builder import MapBuilder

# Chairs face the way they say: "n" = the sitter looks up (north), etc.


def _chairs_around(b: MapBuilder, x: int, y: int, w: int, h: int, t: str = "chair") -> None:
    """Chairs on all four sides of a table covering ``x, y, w, h``."""
    for xx in range(x, x + w):
        b.add(t, xx, y - 1, dir="s")
        b.add(t, xx, y + h, dir="n")
    for yy in range(y, y + h):
        b.add(t, x - 1, yy, dir="e")
        b.add(t, x + w, yy, dir="w")


def _desk_pod(b: MapBuilder, x: int, y: int) -> None:
    """Four desks pushed together (two facing two), with their chairs."""
    b.add("desk", x, y, monitor=1).add("desk", x + 2, y, monitor=1)
    b.add("desk", x, y + 1, monitor=1).add("desk", x + 2, y + 1, monitor=1)
    b.add("office_chair", x, y - 1, dir="s").add("office_chair", x + 3, y - 1, dir="s")
    b.add("office_chair", x, y + 2, dir="n").add("office_chair", x + 3, y + 2, dir="n")


def _cafe_set(b: MapBuilder, x: int, y: int, t: str = "cafe_table") -> None:
    """A small table at ``x, y`` with a chair on each side."""
    b.add(t, x, y)
    b.add("chair", x, y - 1, dir="s").add("chair", x, y + 1, dir="n")
    b.add("chair", x - 1, y, dir="e").add("chair", x + 1, y, dir="w")


# ---------------------------------------------------------------------------
# Cozy Office
# ---------------------------------------------------------------------------

def cozy_office() -> dict[str, Any]:
    b = MapBuilder(44, 30)
    b.room(0, 0, 44, 30, floor=".",
           windows=(("n", 2, 3), ("n", 8, 3), ("w", 4, 3), ("w", 11, 3)))

    # Meeting room A (top, carpet) and B (blue carpet), both private.
    b.room(15, 0, 11, 9, floor=",", doors=(("s", 5, 1),), windows=(("n", 3, 4),))
    b.add("table_long", 18, 3, w=5, h=2)
    _chairs_around(b, 18, 3, 5, 2)
    b.add("whiteboard", 16, 1, label="Agenda",
          text="Weekly sync\n- Wins of the week\n- Blockers\n- Next steps")
    b.add("tv", 22, 1, label="Meeting screen")
    b.add("plant", 24, 7).add("plant", 16, 7)
    b.area("Meeting room A", "private", 16, 1, 9, 7)

    b.room(25, 0, 10, 9, floor="b", doors=(("s", 4, 1),), windows=(("n", 3, 3),))
    b.add("table_round", 29, 3)
    _chairs_around(b, 29, 3, 2, 2)
    b.add("whiteboard", 26, 1, label="Ideas", text="Put your ideas here.")
    b.add("plant", 33, 1).add("plant", 26, 7).add("lamp", 33, 7)
    b.area("Meeting room B", "private", 26, 1, 8, 7)

    # Four nooks along the east wall, reached from a corridor.
    for k in range(4):
        y0 = 4 * k
        b.room(37, y0, 7, 5, floor=";" if k % 2 else ",", doors=(("w", 2, 1),))
        b.add("armchair", 39, y0 + 2, dir="e").add("armchair", 41, y0 + 2, dir="w")
        b.add("coffee_table", 39, y0 + 1, w=1).add("plant", 42, y0 + 1).add("lamp", 42, y0 + 3)
        b.area(f"Nook {k + 1}", "private", 38, y0 + 1, 5, 3)

    # Open desks.
    for px, py in ((2, 3), (8, 3), (2, 9), (8, 9), (2, 15), (8, 15)):
        _desk_pod(b, px, py)
    b.add("bookshelf", 5, 1).add("printer", 11, 1).add("plant", 1, 1).add("plant", 13, 1)
    b.add("big_plant", 14, 19).add("water_cooler", 13, 7)

    # Kitchen and lounge behind a wall with a door.
    b.wall(1, 20, 14, 1)
    b.clear_wall(12, 20, 2)
    b.wall(15, 20, 1, 9)
    b.clear_wall(15, 25, 1, 2)
    b.fill(1, 21, 14, 3, "_")
    for x in range(1, 5):
        b.add("counter", x, 21)
    b.add("coffee_machine", 5, 21).add("fridge", 6, 21).add("vending", 8, 21)
    b.add("water_cooler", 9, 21).add("trash", 10, 21)
    b.add("rug", 2, 24, w=7, h=4, color="rose")
    b.add("sofa", 3, 24, dir="s").add("sofa", 6, 24, dir="s")
    b.add("coffee_table", 4, 26)
    b.add("armchair", 2, 26, dir="e").add("armchair", 8, 26, dir="w")
    b.add("plant", 1, 28).add("arcade", 9, 24)
    _cafe_set(b, 12, 26)
    b.area("Coffee table", "private", 11, 25, 3, 3)

    # Reception, where people arrive.
    b.fill(16, 21, 12, 8, "-")
    for x in range(19, 24):
        b.add("counter", x, 22)
    b.add("office_chair", 21, 21, dir="s")
    b.add("plant", 16, 21).add("plant", 27, 21).add("big_plant", 16, 28).add("big_plant", 27, 28)
    b.add("rug", 19, 25, w=5, h=3, color="teal")
    b.add("note", 18, 27, label="Welcome",
          text="Welcome to Nooklane!\n\nWalk with the arrow keys or WASD, or click where you want to go.\n"
               "Walk up to people to talk: the closer you are, the clearer you hear them.\n"
               "Rooms with a dashed outline are private: only the people inside hear each other.")
    b.spawn(20, 26, 4, 2)

    # Hall between the rooms.
    b.add("painting", 18, 8).add("painting", 31, 8)
    b.add("plant", 16, 9).add("plant", 34, 15).add("cafe_table", 22, 13).add("cafe_table", 27, 13)

    # Town hall: a stage everyone hears.
    b.fill(30, 17, 12, 2, "=")
    b.add("podium", 35, 17)
    b.area("Town hall stage", "spotlight", 30, 17, 12, 2)
    for y in (20, 22, 24):
        for x in list(range(30, 35)) + list(range(37, 42)):
            b.add("chair", x, y, dir="n")
    b.add("big_plant", 42, 17).add("big_plant", 29, 17).add("lamp_post", 42, 27)
    return b.to_json()


# ---------------------------------------------------------------------------
# Courtyard Café
# ---------------------------------------------------------------------------

def courtyard_cafe() -> dict[str, Any]:
    b = MapBuilder(40, 30, floor='"')
    b.wall(0, 0, 40, 1, "h").wall(0, 29, 40, 1, "h").wall(0, 0, 1, 30, "h").wall(39, 0, 1, 30, "h")

    # Paths and the plaza with its fountain.
    b.fill(1, 14, 38, 2, ":").fill(19, 1, 2, 28, ":")
    b.fill(14, 10, 12, 10, "-")
    b.add("fountain", 18, 13)
    for x, y in ((14, 10), (25, 10), (14, 19), (25, 19)):
        b.add("lamp_post", x, y)
    b.add("bench", 15, 12).add("bench", 23, 12).add("bench", 15, 17).add("bench", 23, 17)

    # The café.
    b.room(1, 1, 14, 9, floor=".", doors=(("s", 6, 2),), windows=(("s", 2, 3), ("s", 10, 2), ("n", 4, 6)))
    for x in range(2, 7):
        b.add("counter", x, 2)
    b.add("coffee_machine", 7, 2).add("fridge", 8, 2).add("plant", 13, 2).add("plant", 2, 8)
    for i, x in enumerate((4, 8, 12)):
        b.add("cafe_table", x, 5)
        b.add("chair", x - 1, 5, dir="e").add("chair", x + 1, 5, dir="w")
        b.area(f"Café table {i + 1}", "private", x - 1, 4, 3, 3)
    b.add("note", 10, 2, label="Menu", text="Today\n- Oolong latte\n- Pineapple cake\n- Bubble tea")

    # Terrace with umbrella tables, each a private table.
    b.fill(23, 2, 15, 9, "-")
    for i, (x, y) in enumerate(((26, 4), (31, 4), (36, 4), (26, 8), (31, 8))):
        _cafe_set(b, x, y, "umbrella")
        b.area(f"Terrace table {i + 1}", "private", x - 1, y - 1, 3, 3)
    b.add("flowers", 23, 2).add("flowers", 23, 10).add("plant", 37, 10)

    # Band stage, heard by everyone.
    b.fill(3, 20, 10, 3, "=")
    b.add("piano", 4, 20).add("lamp_post", 2, 20).add("lamp_post", 13, 20)
    b.area("Band stage", "spotlight", 3, 20, 10, 3)
    for x in (4, 6, 8, 10):
        b.add("log", x, 24).add("log", x, 26)

    # Quiet garden with bench nooks.
    for i, (x, y) in enumerate(((26, 21), (32, 21), (26, 25), (32, 25))):
        b.add("bench", x, y, dir="s").add("bench", x, y + 2, dir="n")
        b.add("flowers", x + 2, y + 1)
        b.area(f"Bench nook {i + 1}", "private", x, y, 3, 3)

    for x, y in ((2, 11), (8, 11), (12, 12), (2, 17), (9, 17), (27, 12), (33, 12), (37, 13),
                 (37, 17), (24, 23), (37, 22), (37, 27), (16, 25), (17, 27), (2, 28), (13, 27)):
        b.add("tree", x, y)
    for x, y in ((5, 12), (11, 17), (30, 17), (35, 17), (22, 26), (15, 22)):
        b.add("flowers", x, y)
    b.add("bush", 22, 1).add("bush", 17, 1).add("rock", 30, 13)
    b.spawn(18, 17, 4, 2)
    return b.to_json()


# ---------------------------------------------------------------------------
# Conference Hall
# ---------------------------------------------------------------------------

def conference_hall() -> dict[str, Any]:
    b = MapBuilder(50, 34)
    b.room(0, 0, 50, 34, floor="-")

    # Auditorium with a stage.
    b.room(1, 1, 28, 18, floor="b", doors=(("s", 12, 4),))
    b.fill(6, 2, 18, 3, "=")
    b.add("podium", 14, 3).add("tv", 18, 2, label="Main screen")
    b.area("Main stage", "spotlight", 6, 2, 18, 3)
    for y in (7, 9, 11, 13, 15):
        for x in list(range(5, 13)) + list(range(17, 25)):
            b.add("chair", x, y, dir="n")
    b.add("big_plant", 2, 2).add("big_plant", 27, 2).add("lamp", 2, 17).add("lamp", 27, 17)

    # Four breakout rooms.
    names = ("Breakout A", "Breakout B", "Breakout C", "Breakout D")
    for i, (x, y, door) in enumerate(((30, 1, "s"), (40, 1, "s"), (30, 11, "n"), (40, 11, "n"))):
        b.room(x, y, 10, 8, floor="," if i % 2 == 0 else ";", doors=((door, 4, 2),))
        ty = y + 3 if door == "s" else y + 3
        b.add("table_long", x + 3, ty, w=4, h=2)
        _chairs_around(b, x + 3, ty, 4, 2)
        wb_y = y + 1
        b.add("whiteboard", x + 1, wb_y, label=names[i], text="")
        b.add("plant", x + 8, y + 1 if door == "s" else y + 6)
        b.area(names[i], "private", x + 1, y + 1, 8, 6)

    # Expo booths.
    for i, x in enumerate((2, 10, 18, 26, 34, 42)):
        b.add("rug", x, 20, w=6, h=4, color="teal" if i % 2 else "gold")
        b.add("tv", x + 2, 20, label=f"Booth {i + 1} poster")
        b.add("cafe_table", x + 1, 22).add("plant", x + 5, 20)
        b.area(f"Booth {i + 1}", "private", x, 20, 6, 4)

    # Lobby with registration.
    for x in range(20, 30):
        b.add("counter", x, 27)
    b.add("note", 18, 28, label="Schedule",
          text="10:00 Keynote (Main stage)\n11:00 Breakouts A-D\n12:30 Lunch & expo booths\n"
               "14:00 Lightning talks\n16:00 Closing")
    b.add("sofa", 3, 29, dir="s").add("sofa", 6, 29, dir="s").add("coffee_table", 4, 31)
    b.add("sofa", 41, 29, dir="s").add("sofa", 44, 29, dir="s").add("coffee_table", 42, 31)
    b.add("big_plant", 1, 32).add("big_plant", 48, 32).add("big_plant", 1, 26).add("big_plant", 48, 26)
    b.add("vending", 33, 32).add("water_cooler", 35, 32).add("coffee_machine", 14, 32).add("counter", 15, 32)
    b.spawn(22, 30, 6, 2)
    return b.to_json()


# ---------------------------------------------------------------------------
# Classroom
# ---------------------------------------------------------------------------

def classroom() -> dict[str, Any]:
    b = MapBuilder(36, 26)
    b.room(0, 0, 36, 26, floor=".", windows=(("n", 22, 6), ("w", 8, 3), ("w", 15, 3), ("e", 8, 3), ("e", 15, 3)))

    # Teacher's spot: a podium everyone hears, and the whiteboard.
    b.fill(12, 2, 10, 3, "=")
    b.add("whiteboard", 13, 1, w=4, label="Today's lesson",
          text="Today's lesson\n1. Warm-up\n2. Group work at your table\n3. Share back")
    b.add("tv", 18, 1, label="Slides")
    b.add("podium", 17, 3)
    b.area("Teacher's spot", "spotlight", 12, 2, 10, 3)

    # Six group tables, each private.
    for i, (x, y) in enumerate(((6, 8), (16, 8), (26, 8), (6, 15), (16, 15), (26, 15))):
        b.add("table_round", x, y)
        _chairs_around(b, x, y, 2, 2)
        b.area(f"Group {i + 1}", "private", x - 1, y - 1, 4, 4)

    # Reading nook.
    b.add("bookshelf", 1, 1).add("bookshelf", 3, 1).add("bookshelf", 5, 1)
    b.add("rug", 2, 3, w=5, h=2, color="gold")
    b.add("armchair", 2, 3, dir="s").add("armchair", 6, 3, dir="s").add("lamp", 1, 4)
    b.area("Reading nook", "private", 1, 2, 7, 3)

    b.add("big_plant", 34, 1).add("big_plant", 34, 24).add("big_plant", 1, 24)
    b.add("note", 30, 1, label="Class rules",
          text="Class rules\n- Raise your hand (press H) to speak on the teacher's spot\n"
               "- Talk freely at your group table\n- Be kind")
    b.add("trash", 33, 24)
    b.spawn(15, 22, 6, 2)
    return b.to_json()


# ---------------------------------------------------------------------------
# Garden Park
# ---------------------------------------------------------------------------

def garden_park() -> dict[str, Any]:
    b = MapBuilder(46, 34, floor='"')
    b.wall(0, 0, 46, 1, "h").wall(0, 33, 46, 1, "h").wall(0, 0, 1, 34, "h").wall(45, 0, 1, 34, "h")

    # Paths.
    b.fill(1, 16, 44, 2, ":").fill(22, 1, 2, 32, ":")
    b.fill(8, 12, 2, 4, ":").fill(8, 12, 9, 1, ":")
    b.fill(30, 18, 2, 4, ":").fill(30, 21, 8, 1, ":")

    # Open-air stage.
    b.fill(17, 2, 12, 3, "=")
    b.add("lamp_post", 16, 2).add("lamp_post", 29, 2)
    b.area("Open-air stage", "spotlight", 17, 2, 12, 3)
    for x in range(17, 29, 2):
        b.add("log", x, 7)

    # Pond.
    b.fill(30, 4, 12, 9, "s").fill(31, 5, 10, 7, "~")
    b.add("rock", 30, 4).add("rock", 41, 12).add("flowers", 29, 8)
    b.add("bench", 33, 13, dir="n").add("bench", 37, 13, dir="n")
    b.area("Pond bench 1", "private", 33, 13, 2, 2)
    b.area("Pond bench 2", "private", 37, 13, 2, 2)

    # Campfire circle.
    b.add("campfire", 12, 8)
    for x, y in ((10, 8), (14, 8), (12, 6), (12, 10), (10, 6), (14, 6), (10, 10), (14, 10)):
        b.add("log", x, y)
    b.area("Campfire", "private", 9, 5, 7, 7)

    # Gazebo with benches.
    b.fill(33, 23, 8, 6, ".")
    b.wall(32, 22, 10, 1, "f").wall(32, 29, 10, 1, "f").wall(32, 22, 1, 8, "f").wall(41, 22, 1, 8, "f")
    b.clear_wall(36, 22, 2)
    b.add("bench", 34, 24, dir="s").add("bench", 38, 24, dir="s")
    b.add("bench", 34, 27, dir="n").add("bench", 38, 27, dir="n")
    b.add("flowers", 33, 23).add("flowers", 40, 23)
    b.area("Gazebo", "private", 33, 23, 8, 6)

    # Picnic tables.
    for i, x in enumerate((5, 13)):
        b.add("picnic_table", x, 24)
        b.add("log", x - 1, 24).add("log", x - 1, 25).add("log", x + 2, 24).add("log", x + 2, 25)
        b.area(f"Picnic table {i + 1}", "private", x - 1, 23, 4, 4)

    for x, y in ((2, 2), (5, 3), (3, 7), (2, 12), (6, 14), (2, 20), (4, 29), (9, 31), (16, 29),
                 (19, 22), (26, 25), (27, 30), (43, 2), (44, 16), (43, 20), (43, 30), (35, 31),
                 (17, 12), (27, 12), (19, 9), (26, 9)):
        b.add("pine" if (x + y) % 3 == 0 else "tree", x, y)
    for x, y in ((7, 19), (11, 20), (18, 19), (26, 19), (27, 22), (40, 18), (25, 28), (11, 28)):
        b.add("flowers", x, y)
    for x, y in ((21, 15), (24, 15), (21, 18), (24, 18)):
        b.add("lamp_post", x, y)
    b.add("bush", 28, 15).add("bush", 17, 15).add("bush", 40, 15)
    b.add("note", 25, 13, label="Park map",
          text="Garden Park\n- Open-air stage (north): everyone hears the speaker\n"
               "- Campfire, picnic tables, pond benches and the gazebo are private\n- The rest is open: walk up to talk")
    b.spawn(20, 19, 2, 2)
    b.spawn(24, 19, 2, 2)
    return b.to_json()


# ---------------------------------------------------------------------------
# Blank room
# ---------------------------------------------------------------------------

def blank_room() -> dict[str, Any]:
    b = MapBuilder(24, 18)
    b.room(0, 0, 24, 18, floor=".", windows=(("n", 4, 4), ("n", 15, 4)))
    b.add("plant", 1, 1).add("plant", 22, 1).add("plant", 1, 16).add("plant", 22, 16)
    b.spawn(10, 8, 4, 2)
    return b.to_json()


# id -> metadata + builder. Names and descriptions in English and 繁體中文.
TEMPLATES: dict[str, dict[str, Any]] = {
    "office": {
        "build": cozy_office,
        "category": "office",
        "name": {"en": "Cozy Office", "zh": "溫馨辦公室"},
        "about": {
            "en": "Desks, two meeting rooms, four quiet nooks, a kitchen lounge and a town hall stage.",
            "zh": "辦公桌區、兩間會議室、四個安靜小角落、茶水間沙發區和全員大會舞台。",
        },
        "people": "2-25",
    },
    "courtyard": {
        "build": courtyard_cafe,
        "category": "social",
        "name": {"en": "Courtyard Café", "zh": "庭院咖啡館"},
        "about": {
            "en": "An outdoor plaza with a fountain, a café, umbrella tables, a band stage and bench nooks.",
            "zh": "有噴水池的戶外廣場、咖啡館、陽傘桌、樂團舞台和花園長椅角落。",
        },
        "people": "5-40",
    },
    "conference": {
        "build": conference_hall,
        "category": "event",
        "name": {"en": "Conference Hall", "zh": "研討會館"},
        "about": {
            "en": "A keynote auditorium, four breakout rooms, six expo booths and a lobby with registration.",
            "zh": "主講廳、四間分組討論室、六個攤位，和有報到櫃台的大廳。",
        },
        "people": "10-60",
    },
    "classroom": {
        "build": classroom,
        "category": "education",
        "name": {"en": "Classroom", "zh": "教室"},
        "about": {
            "en": "A teacher's spot the whole class hears, six private group tables and a reading nook.",
            "zh": "全班都聽得到的講台、六張各自獨立的分組桌，還有閱讀角。",
        },
        "people": "5-30",
    },
    "park": {
        "build": garden_park,
        "category": "social",
        "name": {"en": "Garden Park", "zh": "花園公園"},
        "about": {
            "en": "Lawns and paths, a pond, a campfire circle, picnic tables, a gazebo and an open-air stage.",
            "zh": "草地和步道、池塘、營火圈、野餐桌、涼亭和露天舞台。",
        },
        "people": "5-40",
    },
    "blank": {
        "build": blank_room,
        "category": "build",
        "name": {"en": "Blank Room", "zh": "空白房間"},
        "about": {
            "en": "An empty room to build your own place in.",
            "zh": "一間空房間，自己動手佈置。",
        },
        "people": "any",
    },
}

DEFAULT_TEMPLATE = "office"

# The words written in the templates (area names, labels, board and note
# texts) in 繁體中文; numbered names ("Nook 3") go through _ZH_NUMBERED.
_ZH = {
    "Meeting room A": "會議室 A",
    "Meeting room B": "會議室 B",
    "Coffee table": "咖啡桌",
    "Town hall stage": "全員大會舞台",
    "Agenda": "議程",
    "Weekly sync\n- Wins of the week\n- Blockers\n- Next steps": "每週同步\n- 這週的好消息\n- 卡住的地方\n- 下一步",
    "Meeting screen": "會議螢幕",
    "Ideas": "點子",
    "Put your ideas here.": "把你的點子寫在這裡。",
    "Welcome": "歡迎",
    (
        "Welcome to Nooklane!\n\nWalk with the arrow keys or WASD, or click where you want to go.\n"
        "Walk up to people to talk: the closer you are, the clearer you hear them.\n"
        "Rooms with a dashed outline are private: only the people inside hear each other."
    ): (
        "歡迎來到 Nooklane！\n\n用方向鍵或 WASD 走路，或直接點想去的地方。\n"
        "走到別人身邊就能聊天：靠得越近，聽得越清楚。\n"
        "有虛線框的房間是私人的：只有裡面的人聽得到彼此。"
    ),
    "Band stage": "樂團舞台",
    "Menu": "菜單",
    "Today\n- Oolong latte\n- Pineapple cake\n- Bubble tea": "今日供應\n- 烏龍拿鐵\n- 鳳梨酥\n- 珍珠奶茶",
    "Main stage": "主舞台",
    "Main screen": "主螢幕",
    "Schedule": "議程表",
    (
        "10:00 Keynote (Main stage)\n11:00 Breakouts A-D\n12:30 Lunch & expo booths\n"
        "14:00 Lightning talks\n16:00 Closing"
    ): "10:00 主題演講（主舞台）\n11:00 分組討論 A-D\n12:30 午餐與攤位\n14:00 閃電講\n16:00 閉幕",
    "Teacher's spot": "講台",
    "Today's lesson": "今天的課",
    "Today's lesson\n1. Warm-up\n2. Group work at your table\n3. Share back": "今天的課\n1. 暖身\n2. 在你的桌子分組討論\n3. 上台分享",
    "Slides": "投影片",
    "Reading nook": "閱讀角",
    "Class rules": "班規",
    (
        "Class rules\n- Raise your hand (press H) to speak on the teacher's spot\n"
        "- Talk freely at your group table\n- Be kind"
    ): "班規\n- 想上講台發言先舉手（按 H）\n- 在分組桌可以自由討論\n- 對人友善",
    "Open-air stage": "露天舞台",
    "Campfire": "營火",
    "Gazebo": "涼亭",
    "Park map": "公園地圖",
    (
        "Garden Park\n- Open-air stage (north): everyone hears the speaker\n"
        "- Campfire, picnic tables, pond benches and the gazebo are private\n- The rest is open: walk up to talk"
    ): "花園公園\n- 露天舞台（北邊）：全場都聽得到台上的人\n- 營火、野餐桌、池畔長椅和涼亭是私人的\n- 其他地方都開放：走過去就能聊",
}
_ZH_NUMBERED = {
    "Nook": "小角落",
    "Café table": "咖啡桌",
    "Terrace table": "露台桌",
    "Bench nook": "長椅角落",
    "Breakout": "分組討論室",
    "Booth": "攤位",
    "Group": "第 {n} 組",
    "Pond bench": "池畔長椅",
    "Picnic table": "野餐桌",
}


def _zh(text: str) -> str:
    if text in _ZH:
        return _ZH[text]
    for prefix, word in _ZH_NUMBERED.items():
        if text.startswith(prefix + " "):
            rest = text[len(prefix) + 1:]
            if rest.endswith(" poster"):
                return f"{word} {rest[:-7]} 海報"
            return word.format(n=rest) if "{n}" in word else f"{word} {rest}"
    return text


def localize(data: dict[str, Any], lang: str) -> dict[str, Any]:
    """The template's words in ``lang`` (English as built, or ``zh``)."""
    if lang != "zh":
        return data
    for area in data["areas"]:
        area["name"] = _zh(area["name"])
    for obj in data["objects"]:
        for key in ("label", "text"):
            if obj.get(key):
                obj[key] = _zh(obj[key])
    return data


def build(template_id: str, lang: str = "en") -> dict[str, Any]:
    entry = TEMPLATES.get(template_id) or TEMPLATES[DEFAULT_TEMPLATE]
    builder: Callable[[], dict[str, Any]] = entry["build"]
    return localize(builder(), lang)
