"""The templates are valid, fully walkable maps."""

import pytest

from nooklane.maps import TEMPLATES, build, validate
from nooklane.maps.builder import OBJECTS, MapBuilder, reachable, solid_tiles


@pytest.mark.parametrize("template", sorted(TEMPLATES))
def test_template_is_valid_and_walkable(template):
    m = build(template)
    assert validate(m) == []
    blocked = solid_tiles(m)
    walkable = {(x, y) for y in range(m["h"]) for x in range(m["w"])} - blocked
    assert reachable(m, tuple(m["spawns"][0])) == walkable


@pytest.mark.parametrize("template", sorted(TEMPLATES))
def test_every_area_can_be_entered(template):
    m = build(template)
    reach = reachable(m, tuple(m["spawns"][0]))
    for area in m["areas"]:
        tiles = {(x, y) for rx, ry, rw, rh in area["rects"] for y in range(ry, ry + rh) for x in range(rx, rx + rw)}
        assert tiles & reach, area["name"]


def test_templates_have_names_in_both_languages():
    for tid, t in TEMPLATES.items():
        assert t["name"]["en"] and t["name"]["zh"], tid
        assert t["about"]["en"] and t["about"]["zh"], tid


def test_object_table_matches_the_browser():
    # assets/nooklane/art.js lists the same types.
    from pathlib import Path
    art = (Path(__file__).resolve().parent.parent / "assets" / "nooklane" / "art.js").read_text()
    for t in OBJECTS:
        assert f"\n    {t}: {{" in art, t


def test_validate_rejects_broken_maps():
    b = MapBuilder(8, 6)
    b.room(0, 0, 8, 6)
    b.spawn(3, 3)
    good = b.to_json()
    assert validate(good) == []
    bad = dict(good, floor=good["floor"][:-1])
    assert validate(bad)
    bad = dict(good, spawns=[[0, 0]])  # on a wall
    assert any("blocked" in p for p in validate(bad))
    bad = dict(good, objects=[{"t": "spaceship", "x": 1, "y": 1}])
    assert validate(bad)
    bad = dict(good, areas=[{"id": "a1", "name": "x", "kind": "secret", "rects": [[1, 1, 2, 2]]}])
    assert validate(bad)
    assert validate("not a map") == ["not an object"]


@pytest.mark.parametrize("template", sorted(TEMPLATES))
def test_chinese_spaces_have_chinese_words(template):
    m = build(template, "zh")
    assert validate(m) == []
    words = [a["name"] for a in m["areas"]]
    words += [o[k] for o in m["objects"] for k in ("label", "text") if o.get(k)]
    english_only = [w for w in words if w.isascii()]
    assert english_only == [], english_only
