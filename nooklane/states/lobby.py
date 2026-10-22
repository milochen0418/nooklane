import asyncio
import dataclasses
import json

import reflex as rx

from nooklane import rooms, spaces
from nooklane.maps import TEMPLATES
from nooklane.i18n import tr
from nooklane.states.lang import LangState

_REFRESHES = 40
_REFRESH_S = 15


@dataclasses.dataclass
class SpaceCard:
    id: str = ""
    name: str = ""
    kind: str = ""
    people: int = 0
    inside: str = ""
    thumb: str = ""
    href: str = ""


class LobbyState(LangState):
    """The front page: the spaces on this server and the templates for a new one."""

    spaces: list[SpaceCard] = []
    create_template: str = ""
    create_open: bool = False
    create_error: str = ""
    creating: bool = False
    # space id -> build key, for the spaces this browser made.
    build_keys: str = rx.LocalStorage("{}", name="nooklane_keys")
    _refreshing: bool = False

    @rx.var
    def templates(self) -> list[dict[str, str]]:
        lang = self.ui_lang
        return [
            {
                "id": tid,
                "name": t["name"].get(lang, t["name"]["en"]),
                "about": t["about"].get(lang, t["about"]["en"]),
                "people": tr(lang, "people_range", n=t["people"]) if t["people"] != "any" else "",
                "category": t["category"],
            }
            for tid, t in TEMPLATES.items()
        ]

    @rx.var
    def create_template_name(self) -> str:
        t = TEMPLATES.get(self.create_template)
        return t["name"].get(self.ui_lang, t["name"]["en"]) if t else ""

    async def _load(self) -> None:
        listed = await asyncio.to_thread(spaces.list_spaces)
        counts = await rooms.occupancy()
        lang = self.ui_lang
        out = []
        for s in listed:
            n = counts.get(s["id"], 0)
            t = TEMPLATES.get(s["template"])
            out.append(SpaceCard(
                id=s["id"],
                name=s["name"],
                kind=t["name"].get(lang, t["name"]["en"]) if t else "",
                people=n,
                inside=tr(lang, "inside", n=n) if n else tr(lang, "nobody_inside"),
                thumb=f"/_nooklane/map/{s['id']}?v={s['version']}",
                href=f"/s/{s['id']}",
            ))
        self.spaces = out

    @rx.event
    async def on_load(self):
        # Back from a space: leave its room (the camera goes off too).
        yield rx.call_script("window.nooklane && (window.nooklane.disconnect(), window.nooklane.stopPreview())")
        await asyncio.to_thread(spaces.ensure_starter_space)
        await self._load()
        if not self._refreshing:
            self._refreshing = True
            yield LobbyState.refresh_counts

    @rx.event(background=True)
    async def refresh_counts(self):
        """Keep the "N inside" badges fresh for a while."""
        try:
            for _ in range(_REFRESHES):
                await asyncio.sleep(_REFRESH_S)
                async with self:
                    if self.router.url.path not in ("/", ""):
                        return
                    await self._load()
        finally:
            async with self:
                self._refreshing = False

    @rx.event
    def open_create(self, template_id: str):
        self.create_template = template_id
        self.create_error = ""
        self.create_open = True

    @rx.event
    def set_create_open(self, value: bool):
        self.create_open = value

    @rx.event
    async def create_space(self, form: dict):
        name = (form.get("name") or "").strip()
        if not name:
            self.create_error = tr(self.ui_lang, "err_name_required")
            return
        self.creating = True
        yield
        try:
            space, key = await asyncio.to_thread(spaces.create_space, name, self.create_template, self.ui_lang)
        except spaces.SpaceError as exc:
            self.create_error = tr(self.ui_lang, f"err_{exc.key}", detail=exc.detail)
            return
        finally:
            self.creating = False
        try:
            keys = json.loads(self.build_keys or "{}")
        except ValueError:
            keys = {}
        keys[space["id"]] = key
        self.build_keys = json.dumps(keys)
        self.create_open = False
        yield rx.redirect(f"/s/{space['id']}")
