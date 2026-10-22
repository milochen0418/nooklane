"""Spaces on disk: creating, who may rearrange them, and what anyone may change."""

import importlib

import pytest


@pytest.fixture()
def spaces(tmp_path, monkeypatch):
    monkeypatch.setenv("NOOKLANE_DATA_DIR", str(tmp_path))
    monkeypatch.delenv("ADMIN_PASSCODE", raising=False)
    import nooklane.paths
    import nooklane.spaces
    importlib.reload(nooklane.paths)
    return importlib.reload(nooklane.spaces)


def test_create_list_and_read(spaces):
    space, key = spaces.create_space("  Team   Office ", "office")
    assert space["name"] == "Team Office"
    assert space["id"].startswith("team-office-")
    assert spaces.valid_id(space["id"])
    assert [s["id"] for s in spaces.list_spaces()] == [space["id"]]
    assert spaces.get_space(space["id"])["map"]["w"] == 44
    assert spaces.can_build(space, key)
    assert not spaces.can_build(space, "wrong")


def test_starter_space_only_once(spaces):
    spaces.ensure_starter_space()
    spaces.ensure_starter_space()
    listed = spaces.list_spaces()
    assert [s["id"] for s in listed] == ["nooklane-hq"]
    # Nobody owns it: only the admin passcode rearranges it.
    assert not spaces.can_build(spaces.get_space("nooklane-hq"), "anything")


def test_admin_passcode_unlocks_every_space(spaces, monkeypatch):
    space, _key = spaces.create_space("Mine", "blank")
    monkeypatch.setenv("ADMIN_PASSCODE", "letmein")
    assert spaces.can_build(space, "letmein")


def test_save_map_needs_the_key_and_a_valid_map(spaces):
    space, key = spaces.create_space("Room", "blank")
    m = space["map"]
    m["objects"].append({"t": "sofa", "x": 5, "y": 5, "dir": "s"})
    with pytest.raises(spaces.SpaceError) as err:
        spaces.save_map(space["id"], m, "wrong")
    assert err.value.key == "not_allowed"
    assert spaces.save_map(space["id"], m, key) == 2
    assert spaces.get_space(space["id"])["map"]["objects"][-1]["t"] == "sofa"
    broken = dict(m, spawns=[])
    with pytest.raises(spaces.SpaceError) as err:
        spaces.save_map(space["id"], broken, key)
    assert err.value.key == "map_invalid"


def test_anyone_can_write_on_boards_and_set_screens(spaces):
    space, _key = spaces.create_space("Office", "office")
    objects = space["map"]["objects"]
    board = next(i for i, o in enumerate(objects) if o["t"] == "whiteboard")
    screen = next(i for i, o in enumerate(objects) if o["t"] == "tv")
    desk = next(i for i, o in enumerate(objects) if o["t"] == "desk")
    v = spaces.update_object(space["id"], board, {"text": "Hello"})
    v = spaces.update_object(space["id"], screen, {"url": "https://md.reflex-ddns.com/doc/1"})
    assert v == 3
    stored = spaces.get_space(space["id"])["map"]["objects"]
    assert stored[board]["text"] == "Hello"
    assert stored[screen]["url"] == "https://md.reflex-ddns.com/doc/1"
    with pytest.raises(spaces.SpaceError):
        spaces.update_object(space["id"], screen, {"url": "javascript:alert(1)"})
    spaces.update_object(space["id"], desk, {"text": "ignored"})
    assert "text" not in spaces.get_space(space["id"])["map"]["objects"][desk]


def test_rename_and_delete(spaces):
    space, key = spaces.create_space("Old", "blank")
    with pytest.raises(spaces.SpaceError):
        spaces.rename_space(space["id"], "New", "wrong")
    spaces.rename_space(space["id"], "New", key)
    assert spaces.get_space(space["id"])["name"] == "New"
    with pytest.raises(spaces.SpaceError):
        spaces.delete_space(space["id"], "wrong")
    spaces.delete_space(space["id"], key)
    assert spaces.get_space(space["id"]) is None
