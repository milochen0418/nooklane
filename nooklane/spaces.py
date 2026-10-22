"""Spaces: a name, a map and who may rearrange it, one JSON file each.

    {"id": "team-office-3f2a", "name": "Team office", "template": "office",
     "created": 1730000000.0, "updated": 1730000000.0, "version": 3,
     "owner": "<sha256 of the build key>", "map": {...}}

Whoever creates a space gets its *build key* (kept in their browser); the key,
or the server's ``ADMIN_PASSCODE``, unlocks the map editor. Anyone in the
space may change what is written on boards and notes, the link a screen
shows, and where a portal leads (``update_object``), like in a real office.

Every change bumps ``version``; browsers that see a newer version reload the
map (``nooklane.notifyMap`` tells the others).
"""

from __future__ import annotations

import contextlib
import copy
import fcntl
import hashlib
import hmac
import json
import os
import re
import secrets
import time
import unicodedata
from pathlib import Path
from typing import Any

from nooklane.maps import DEFAULT_TEMPLATE, TEMPLATES, build, validate
from nooklane.paths import SPACES_DIR

_ID = re.compile(r"^[a-z0-9][a-z0-9-]{2,62}$")
NAME_MAX = 60
TEXT_MAX = 5000
URL_MAX = 800
LABEL_MAX = 60


class SpaceError(Exception):
    """A change that cannot be made (with a message key for the page)."""

    def __init__(self, key: str, detail: str = ""):
        super().__init__(f"{key}: {detail}" if detail else key)
        self.key = key
        self.detail = detail


def valid_id(space_id: str) -> bool:
    return bool(_ID.match(space_id or ""))


def _path(space_id: str) -> Path:
    return SPACES_DIR / f"{space_id}.json"


@contextlib.contextmanager
def _lock():
    SPACES_DIR.mkdir(parents=True, exist_ok=True)
    with open(SPACES_DIR / ".lock", "a") as fh:
        fcntl.flock(fh, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(fh, fcntl.LOCK_UN)


def _write(space: dict[str, Any]) -> None:
    SPACES_DIR.mkdir(parents=True, exist_ok=True)
    path = _path(space["id"])
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(space, ensure_ascii=False, separators=(",", ":")))
    os.replace(tmp, path)


def _read(space_id: str) -> dict[str, Any] | None:
    if not valid_id(space_id):
        return None
    try:
        data = json.loads(_path(space_id).read_text())
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) and data.get("id") == space_id else None


def _hash(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


def _slug(name: str) -> str:
    text = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    text = re.sub(r"[^a-z0-9]+", "-", text).strip("-")
    return text[:40] or "space"


def can_build(space: dict[str, Any] | None, key: str) -> bool:
    """Whether ``key`` unlocks the map editor of ``space``."""
    if not space or not key:
        return False
    admin = (os.environ.get("ADMIN_PASSCODE") or "").strip()
    if admin and hmac.compare_digest(key, admin):
        return True
    owner = space.get("owner") or ""
    return bool(owner) and hmac.compare_digest(_hash(key), owner)


def summary(space: dict[str, Any]) -> dict[str, Any]:
    m = space.get("map") or {}
    return {
        "id": space["id"],
        "name": space.get("name") or space["id"],
        "template": space.get("template") or "",
        "version": int(space.get("version") or 1),
        "updated": float(space.get("updated") or 0),
        "size": f"{m.get('w', 0)} × {m.get('h', 0)}",
        "areas": len(m.get("areas") or []),
    }


def list_spaces() -> list[dict[str, Any]]:
    out = []
    if SPACES_DIR.exists():
        for path in SPACES_DIR.glob("*.json"):
            space = _read(path.stem)
            if space:
                out.append(summary(space))
    out.sort(key=lambda s: s["updated"], reverse=True)
    return out


def get_space(space_id: str) -> dict[str, Any] | None:
    return _read(space_id)


def create_space(name: str, template: str, lang: str = "en") -> tuple[dict[str, Any], str]:
    """A new space from a template (its words in ``lang``); returns it and its build key."""
    name = " ".join((name or "").split())[:NAME_MAX]
    if not name:
        raise SpaceError("name_required")
    if template not in TEMPLATES:
        template = DEFAULT_TEMPLATE
    key = secrets.token_urlsafe(18)
    now = time.time()
    with _lock():
        base = _slug(name)
        for _ in range(20):
            space_id = f"{base}-{secrets.token_hex(2)}"
            if not _path(space_id).exists():
                break
        space = {
            "id": space_id, "name": name, "template": template, "created": now, "updated": now,
            "version": 1, "owner": _hash(key), "map": build(template, lang),
        }
        _write(space)
    return space, key


def ensure_starter_space() -> None:
    """The first start opens one space everybody can walk into right away."""
    with _lock():
        if SPACES_DIR.exists() and any(SPACES_DIR.glob("*.json")):
            return
        now = time.time()
        _write({
            "id": "nooklane-hq", "name": "Nooklane HQ", "template": "office", "created": now,
            "updated": now, "version": 1, "owner": "", "map": build("office"),
        })


def save_map(space_id: str, data: Any, key: str) -> int:
    """Replace the map (map editor); returns the new version."""
    problems = validate(data)
    if problems:
        raise SpaceError("map_invalid", "; ".join(problems[:3]))
    with _lock():
        space = _read(space_id)
        if not space:
            raise SpaceError("not_found")
        if not can_build(space, key):
            raise SpaceError("not_allowed")
        space["map"] = copy.deepcopy(data)
        space["version"] = int(space.get("version") or 1) + 1
        space["updated"] = time.time()
        _write(space)
        return space["version"]


def update_object(space_id: str, index: int, fields: dict[str, Any]) -> int:
    """Change what a board / note says, a screen's link or a portal's target."""
    with _lock():
        space = _read(space_id)
        if not space:
            raise SpaceError("not_found")
        objects = space["map"].get("objects") or []
        if not (isinstance(index, int) and 0 <= index < len(objects)):
            raise SpaceError("object_gone")
        obj = objects[index]
        kind = obj.get("t")
        if "text" in fields and kind in ("whiteboard", "note"):
            obj["text"] = str(fields["text"])[:TEXT_MAX]
        if "label" in fields and kind in ("whiteboard", "note", "tv", "portal"):
            label = " ".join(str(fields["label"]).split())[:LABEL_MAX]
            if label:
                obj["label"] = label
        if "url" in fields and kind == "tv":
            url = str(fields["url"]).strip()[:URL_MAX]
            if url and not re.match(r"^https?://", url):
                raise SpaceError("url_invalid")
            obj["url"] = url
        if "to" in fields and kind == "portal":
            to = fields["to"]
            m = space["map"]
            if not (isinstance(to, list) and len(to) == 2 and all(isinstance(v, int) for v in to)
                    and 0 <= to[0] < m["w"] and 0 <= to[1] < m["h"]):
                raise SpaceError("portal_invalid")
            obj["to"] = to
        space["version"] = int(space.get("version") or 1) + 1
        space["updated"] = time.time()
        _write(space)
        return space["version"]


def rename_space(space_id: str, name: str, key: str) -> None:
    name = " ".join((name or "").split())[:NAME_MAX]
    if not name:
        raise SpaceError("name_required")
    with _lock():
        space = _read(space_id)
        if not space:
            raise SpaceError("not_found")
        if not can_build(space, key):
            raise SpaceError("not_allowed")
        space["name"] = name
        space["updated"] = time.time()
        _write(space)


def delete_space(space_id: str, key: str) -> None:
    with _lock():
        space = _read(space_id)
        if not space:
            return
        if not can_build(space, key):
            raise SpaceError("not_allowed")
        _path(space_id).unlink(missing_ok=True)
