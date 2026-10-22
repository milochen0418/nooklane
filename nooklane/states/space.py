"""One space: the pre-join screen, then the space itself.

The map, the people walking on it and their voices and cameras all live in
the browser (``assets/nooklane/client.js``, ``window.nooklane``). This state
keeps what the page shows around them (toolbar, chat, people, dialogs) and
talks to the browser part in both directions: ``rx.call_script`` one way, a
hidden ``<input>`` (``handle_js``) the other.
"""

from __future__ import annotations

import asyncio
import dataclasses
import json
import logging
import random
import time

import reflex as rx

from nooklane import livekit_server, rooms, spaces
from nooklane.i18n import js_strings, tr
from nooklane.states.lang import LangState

BRIDGE_ID = "nook_bridge"
MODES = ("avatar", "face", "full", "off")
STYLES = ("human", "cat", "panda", "robot")
STATUSES = ("available", "busy", "away")
# Number of choices per part of a character, as LOOK_PARTS in assets/nooklane/art.js.
LOOK_PARTS = (("skin", 5), ("hair", 6), ("hairColor", 9), ("shirt", 10), ("pants", 6), ("extra", 5))
CHAT_KEEP = 200


def random_look() -> str:
    parts = [random.randrange(n) for _, n in LOOK_PARTS]
    if parts[5] > 2:
        parts[5] = 0
    return "-".join(str(p) for p in parts)


def _look_parts(look: str) -> list[int]:
    raw = (look or "").split("-")
    out = []
    for i, (_, n) in enumerate(LOOK_PARTS):
        try:
            v = int(raw[i])
        except (IndexError, ValueError):
            v = 0
        out.append(v if 0 <= v < n else 0)
    return out


def _js(fn: str, *args) -> rx.event.EventSpec:
    return rx.call_script(f"window.nooklane && window.nooklane.{fn}({', '.join(json.dumps(a) for a in args)})")


@dataclasses.dataclass
class Person:
    identity: str = ""
    name: str = ""
    status: str = "available"
    mode: str = "off"
    muted: bool = False
    local: bool = False
    near: bool = False
    where: str = ""
    hand: bool = False
    look: str = "0-0-0-0-0-0"


@dataclasses.dataclass
class ChatLine:
    id: str = ""
    name: str = ""
    text: str = ""
    scope: str = "all"
    mine: bool = False
    time: str = ""


_PERSON_FIELDS = {f.name for f in dataclasses.fields(Person)}


class SpaceState(LangState):
    space_id: str = ""
    space_name: str = ""
    found: bool = True
    map_version: int = 0

    # You, remembered in this browser.
    name: str = rx.LocalStorage("", name="nooklane_name")
    look: str = rx.LocalStorage("", name="nooklane_look")
    mode: str = rx.LocalStorage("avatar", name="nooklane_mode")
    style: str = rx.LocalStorage("human", name="nooklane_style")
    mic_pref: str = rx.LocalStorage("1", name="nooklane_mic")
    build_keys: str = rx.LocalStorage("{}", name="nooklane_keys")

    # In the space.
    joined: bool = False
    joining: bool = False
    connection: str = ""
    error: str = ""
    audio_blocked: bool = False
    my_status: str = "available"
    mic_on: bool = True
    sharing: bool = False
    hand: bool = False
    area: str = ""
    area_kind: str = ""
    face_status: str = ""
    following: str = ""
    ring_on: bool = True
    minimap_on: bool = True
    meeting_view: bool = False
    ghost: bool = False

    panel: str = ""
    chat: list[ChatLine] = []
    chat_scope: str = "nearby"
    unread: int = 0
    people: list[Person] = []

    # Build mode.
    build_ok: bool = False
    build_error: str = ""
    ed_dirty: bool = False
    ed_undo: int = 0
    ed_tool: str = "object"
    ed_option: str = "plant"
    ed_picking: bool = False
    ed_sel_kind: str = ""
    ed_sel_type: str = ""
    ed_sel_turns: bool = False
    ed_sel_portal: bool = False
    ed_sel_to: str = ""
    ed_sel_name: str = ""
    ed_sel_area_kind: str = ""
    saving_map: bool = False

    # The board / note / screen / portal dialog.
    dialog_kind: str = ""
    dialog_index: int = -1
    dialog_label: str = ""
    dialog_text: str = ""
    dialog_url: str = ""
    dialog_editing: bool = False

    # --- what the page shows ------------------------------------------------------------

    @rx.var
    def look_now(self) -> str:
        return self.look or "0-0-0-0-0-0"

    @rx.var
    def mic_wanted(self) -> bool:
        return self.mic_pref != "0"

    @rx.var
    def mode_now(self) -> str:
        return self.mode if self.mode in MODES else "avatar"

    @rx.var
    def style_now(self) -> str:
        return self.style if self.style in STYLES else "human"

    @rx.var
    def mode_desc(self) -> str:
        return tr(self.ui_lang, f"mode_{self.mode_now}_desc")

    @rx.var
    def people_count(self) -> int:
        return len(self.people)

    @rx.var
    def people_label(self) -> str:
        return tr(self.ui_lang, "people_count", n=len(self.people))

    @rx.var
    def area_label(self) -> str:
        return tr(self.ui_lang, "you_are_in", area=self.area) if self.area else ""

    @rx.var
    def join_title(self) -> str:
        return tr(self.ui_lang, "join_title", space=self.space_name)

    @rx.var
    def following_label(self) -> str:
        if not self.following:
            return ""
        name = next((p.name for p in self.people if p.identity == self.following), self.following)
        return tr(self.ui_lang, "following", name=name)

    @rx.var
    def chat_placeholder(self) -> str:
        return tr(self.ui_lang, "chat_placeholder_nearby" if self.chat_scope == "nearby" else "chat_placeholder_all")

    @rx.var
    def nobody_near(self) -> bool:
        return self.chat_scope == "nearby" and not any(p.near for p in self.people if not p.local)

    @rx.var
    def ed_sel_label(self) -> str:
        if self.ed_sel_kind == "object":
            return tr(self.ui_lang, f"obj_{self.ed_sel_type}")
        return self.ed_sel_name

    @rx.var
    def ed_portal_label(self) -> str:
        return self.ed_sel_to or tr(self.ui_lang, "nowhere")

    @rx.var
    def my_build_key(self) -> str:
        try:
            return str(json.loads(self.build_keys or "{}").get(self.space_id, ""))
        except ValueError:
            return ""

    # --- loading the space -------------------------------------------------------------------

    def _space_from_url(self) -> str:
        path = str(self.router.url.path or "")
        return path.rstrip("/").rsplit("/", 1)[-1] if path else ""

    @rx.event
    async def on_load(self):
        self.init_lang()
        space_id = self._space_from_url()
        if self.joined:
            # Back on a space page (after the front page, or another space):
            # the browser already left the old room; start at the pre-join screen.
            self.joined = False
            self.people = []
            self.panel = ""
            yield _js("disconnect")
        space = await asyncio.to_thread(spaces.get_space, space_id)
        self.space_id = space_id
        self.found = space is not None
        self.error = ""
        if not space:
            return
        self.space_name = space["name"]
        self.map_version = int(space.get("version") or 1)
        if not self.look:
            self.look = random_look()
        yield rx.call_script(
            "window.nooklane && window.nooklane.configure("
            + json.dumps({"bridge": BRIDGE_ID, "strings": js_strings(self.ui_lang), "space": space_id})
            + ")"
        )
        yield _js("setMap", space["map"], self.map_version)
        if not self.joined:
            yield _js("preview", {"look": self.look_now, "mode": self.mode_now, "style": self.style_now, "name": self.name})

    @rx.event
    async def reload_map(self, version: int = 0):
        space = await asyncio.to_thread(spaces.get_space, self.space_id)
        if not space:
            return
        new_version = int(space.get("version") or 1)
        if version and new_version < version:
            return
        changed = new_version != self.map_version
        self.map_version = new_version
        self.space_name = space["name"]
        yield _js("setMap", space["map"], self.map_version)
        if changed and self.joined and not self.dialog_kind:
            yield rx.toast.info(tr(self.ui_lang, "map_updated"), duration=2500)

    # --- you -----------------------------------------------------------------------------------

    @rx.event
    def set_name(self, value: str):
        self.name = value[:40]

    @rx.event
    def cycle_part(self, index: int, delta: int):
        parts = _look_parts(self.look_now)
        n = LOOK_PARTS[index][1]
        parts[index] = (parts[index] + delta) % n
        self.look = "-".join(str(p) for p in parts)
        yield _js("setLook", self.look)

    @rx.event
    def shuffle_look(self):
        self.look = random_look()
        yield _js("setLook", self.look)

    @rx.event
    def set_mode(self, mode: str):
        if mode not in MODES:
            return
        self.mode = mode
        if self.joined:
            yield _js("setMode", mode)
        else:
            yield _js("preview", {"mode": mode, "style": self.style_now, "look": self.look_now, "name": self.name})

    @rx.event
    def set_style(self, style: str):
        if style not in STYLES:
            return
        self.style = style
        yield _js("setStyle", style)
        if not self.joined:
            yield _js("preview", {"style": style})

    @rx.event
    def toggle_mic_pref(self):
        self.mic_pref = "0" if self.mic_wanted else "1"

    # --- joining and leaving ------------------------------------------------------------------

    @rx.event
    async def join(self, form: dict | None = None):
        name = " ".join(((form or {}).get("name") or self.name or "").split())[:40]
        if not name:
            self.error = tr(self.ui_lang, "name_required")
            return
        self.name = name
        self.error = ""
        self.joining = True
        yield
        try:
            server = await asyncio.to_thread(livekit_server.status)
            if server["phase"] != "running":
                detail = f": {server['message']}" if server["message"] else "."
                self.error = tr(self.ui_lang, "err_server", phase=server["phase"], detail=detail)
                return
            token = rooms.mint_token(self.space_id, name, {
                "look": self.look_now, "mode": self.mode_now, "style": self.style_now,
                "status": "available", "hand": "0",
            })
            self.joined = True
            self.connection = "Connecting..."
            self.my_status = "available"
            self.mic_on = self.mic_wanted
            self.sharing = False
            self.hand = False
            self.ghost = False
            self.meeting_view = False
            self.chat = []
            self.unread = 0
            self.people = []
            self.panel = ""
            self.area = ""
            yield _js("connect", rooms.public_ws_url(), token, {
                "look": self.look_now, "mode": self.mode_now, "style": self.style_now,
                "mic": self.mic_wanted, "name": name, "status": "available",
            })
        except Exception as exc:  # noqa: BLE001 - shown on the page
            logging.exception("join failed")
            self.error = tr(self.ui_lang, "err_unexpected", detail=str(exc))
            self.joined = False
        finally:
            self.joining = False

    @rx.event
    def leave(self):
        if self.panel == "build":
            yield rx.call_script("window.nookEditor && window.nookEditor.close()")
        self.joined = False
        self.connection = ""
        self.people = []
        self.panel = ""
        self.dialog_kind = ""
        self.sharing = False
        yield _js("disconnect")
        yield _js("preview", {"look": self.look_now, "mode": self.mode_now, "style": self.style_now, "name": self.name})
        yield rx.toast.info(tr(self.ui_lang, "left_space"), duration=2000)

    # --- toolbar ----------------------------------------------------------------------------------

    @rx.event
    def toggle_mic(self):
        self.mic_on = not self.mic_on
        self.mic_pref = "1" if self.mic_on else "0"
        yield _js("setMic", self.mic_on)

    @rx.event
    def toggle_share(self):
        yield _js("shareScreen", not self.sharing)

    @rx.event
    def emote(self, index: int):
        yield _js("emote", index)

    @rx.event
    def toggle_hand(self):
        yield _js("toggleHand")

    @rx.event
    def toggle_meeting_view(self):
        yield _js("setMeetingView", not self.meeting_view)

    @rx.event
    def set_status(self, status: str):
        if status not in STATUSES:
            return
        self.my_status = status
        yield _js("setStatus", status)

    @rx.event
    async def toggle_panel(self, panel: str):
        self.panel = "" if self.panel == panel else panel
        if self.panel == "chat":
            self.unread = 0
        if self.panel == "build":
            space = await asyncio.to_thread(spaces.get_space, self.space_id)
            self.build_ok = spaces.can_build(space, self.my_build_key)
            self.build_error = ""
            if self.build_ok:
                yield rx.call_script("window.nookEditor && window.nookEditor.open()")
        else:
            yield rx.call_script("window.nookEditor && window.nookEditor.close()")

    @rx.event
    def close_panel(self):
        if self.panel == "build":
            yield rx.call_script("window.nookEditor && window.nookEditor.close()")
        self.panel = ""

    @rx.event
    def zoom(self, step: int):
        yield _js("zoom", step)

    @rx.event
    def toggle_ring(self):
        self.ring_on = not self.ring_on
        yield _js("setRing", self.ring_on)

    @rx.event
    def respawn(self):
        yield _js("respawn")

    @rx.event
    def toggle_minimap(self):
        self.minimap_on = not self.minimap_on
        yield _js("setMinimap", self.minimap_on)

    @rx.event
    def copy_invite(self):
        url = json.dumps(f"/s/{self.space_id}")
        yield rx.call_script(f"navigator.clipboard.writeText(window.location.origin + {url})")
        yield rx.toast.success(tr(self.ui_lang, "invite_copied"), duration=2000)

    @rx.event
    def enable_audio(self):
        yield _js("startAudio")

    # --- chat and people -------------------------------------------------------------------------

    @rx.event
    def set_chat_scope(self, scope: str):
        self.chat_scope = "all" if scope == "all" else "nearby"

    @rx.event
    def send_chat(self, form: dict):
        text = (form.get("message") or "").strip()
        if not text:
            return
        yield _js("sendChat", text[:2000], self.chat_scope)

    @rx.event
    def locate(self, identity: str):
        yield _js("locate", identity)

    @rx.event
    def walk_to(self, identity: str):
        yield _js("walkTo", identity)

    @rx.event
    def follow(self, identity: str):
        target = "" if self.following == identity else identity
        yield _js("follow", target)

    @rx.event
    def wave(self, identity: str):
        yield _js("wave", identity)

    # --- build mode ------------------------------------------------------------------------------

    @rx.event
    async def unlock_build(self, form: dict):
        key = (form.get("key") or "").strip()
        space = await asyncio.to_thread(spaces.get_space, self.space_id)
        if not spaces.can_build(space, key):
            self.build_error = tr(self.ui_lang, "wrong_key")
            return
        try:
            keys = json.loads(self.build_keys or "{}")
        except ValueError:
            keys = {}
        keys[self.space_id] = key
        self.build_keys = json.dumps(keys)
        self.build_ok = True
        self.build_error = ""
        yield rx.call_script("window.nookEditor && window.nookEditor.open()")

    @rx.event
    def set_tool(self, tool: str, option: str = ""):
        self.ed_tool = tool
        if option:
            self.ed_option = option
        yield rx.call_script(
            f"window.nookEditor && window.nookEditor.setTool({json.dumps(tool)}, {json.dumps(option or None)})"
        )

    @rx.event
    def editor_call(self, method: str):
        if method in ("undo", "discard", "deleteSelected", "rotateSelected", "pickPortalTarget"):
            yield rx.call_script(f"window.nookEditor && window.nookEditor.{method}()")

    @rx.event
    def editor_area_kind(self, kind: str):
        yield rx.call_script(f"window.nookEditor && window.nookEditor.setAreaKind({json.dumps(kind)})")

    @rx.event
    def editor_rename_area(self, form: dict):
        name = (form.get("area_name") or "").strip()[:40]
        if name:
            yield rx.call_script(f"window.nookEditor && window.nookEditor.renameArea({json.dumps(name)})")

    @rx.event
    def save_map(self):
        self.saving_map = True
        yield rx.call_script("window.nookEditor ? window.nookEditor.mapJson() : ''", callback=SpaceState.save_map_json)

    @rx.event
    async def save_map_json(self, raw: str):
        try:
            data = json.loads(raw or "")
        except ValueError:
            self.saving_map = False
            return
        try:
            version = await asyncio.to_thread(spaces.save_map, self.space_id, data, self.my_build_key)
        except spaces.SpaceError as exc:
            self.saving_map = False
            yield rx.toast.error(tr(self.ui_lang, f"err_{exc.key}", detail=exc.detail), duration=6000)
            return
        self.saving_map = False
        self.map_version = version
        yield rx.call_script("window.nookEditor && window.nookEditor.saved()")
        yield _js("setMap", data, version)
        yield _js("notifyMap", version)
        yield rx.toast.success(tr(self.ui_lang, "map_saved"), duration=3000)

    @rx.event
    async def rename_space(self, form: dict):
        name = (form.get("space_name") or "").strip()
        try:
            await asyncio.to_thread(spaces.rename_space, self.space_id, name, self.my_build_key)
        except spaces.SpaceError as exc:
            yield rx.toast.error(tr(self.ui_lang, f"err_{exc.key}", detail=exc.detail))
            return
        self.space_name = " ".join(name.split())[: spaces.NAME_MAX]
        yield rx.toast.success(tr(self.ui_lang, "saved"), duration=1500)

    @rx.event
    async def delete_space(self):
        try:
            await asyncio.to_thread(spaces.delete_space, self.space_id, self.my_build_key)
        except spaces.SpaceError as exc:
            yield rx.toast.error(tr(self.ui_lang, f"err_{exc.key}", detail=exc.detail))
            return
        self.joined = False
        yield _js("disconnect")
        yield rx.redirect("/")

    @rx.event
    def copy_build_key(self):
        key = json.dumps(self.my_build_key)
        yield rx.call_script(f"navigator.clipboard.writeText({key})")
        yield rx.toast.success(tr(self.ui_lang, "copied"), duration=1500)

    # --- the dialog for boards, notes, screens -------------------------------------------------

    @rx.event
    def close_dialog(self):
        self.dialog_kind = ""
        self.dialog_editing = False

    @rx.event
    def set_dialog_open(self, value: bool):
        if not value:
            self.dialog_kind = ""
            self.dialog_editing = False

    @rx.event
    def start_edit(self):
        self.dialog_editing = True

    async def _update_object(self, fields: dict):
        try:
            version = await asyncio.to_thread(spaces.update_object, self.space_id, self.dialog_index, fields)
        except spaces.SpaceError as exc:
            yield rx.toast.error(tr(self.ui_lang, f"err_{exc.key}", detail=exc.detail))
            return
        self.map_version = version
        space = await asyncio.to_thread(spaces.get_space, self.space_id)
        if space:
            yield _js("setMap", space["map"], version)
            yield _js("notifyMap", version)
        yield rx.toast.success(tr(self.ui_lang, "saved"), duration=1500)

    @rx.event
    async def save_text(self, form: dict):
        text = form.get("text") or ""
        self.dialog_text = text[: spaces.TEXT_MAX]
        self.dialog_editing = False
        async for event in self._update_object({"text": text}):
            yield event

    @rx.event
    async def save_url(self, form: dict):
        url = (form.get("url") or "").strip()
        async for event in self._update_object({"url": url}):
            yield event
        if url.startswith(("http://", "https://")):
            self.dialog_url = url

    # --- news from the browser ---------------------------------------------------------------------

    @rx.event
    def handle_js(self, raw: str):
        if not raw:
            return
        try:
            data = json.loads(raw)
        except ValueError:
            return
        lang = self.ui_lang
        if data.get("type") == "error":
            self.error = str(data.get("message") or "")
            self.joined = False
            yield rx.toast.error(self.error)
            yield _js("preview", {"look": self.look_now, "mode": self.mode_now, "style": self.style_now, "name": self.name})
            return
        if data.get("type") == "warning":
            yield rx.toast.warning(str(data.get("message") or ""), duration=5000)
        if "status" in data:
            self.connection = str(data["status"])
            if data["status"] == "Disconnected" and self.joined:
                self.joined = False
                self.people = []
                self.error = tr(lang, "disconnected")
        if "people" in data and isinstance(data["people"], list):
            self.people = [
                Person(**{k: v for k, v in p.items() if k in _PERSON_FIELDS})
                for p in data["people"] if isinstance(p, dict)
            ]
        if "area" in data:
            self.area = str(data["area"] or "")
        if "audio_blocked" in data:
            self.audio_blocked = bool(data["audio_blocked"])
        if "mic" in data:
            self.mic_on = bool(data["mic"])
        if "mode" in data and data["mode"] in MODES:
            self.mode = data["mode"]
        if "face_status" in data:
            self.face_status = str(data["face_status"] or "")
        if "hand" in data:
            self.hand = bool(data["hand"])
        if "ghost" in data:
            self.ghost = bool(data["ghost"])
        if "meeting_view" in data:
            self.meeting_view = bool(data["meeting_view"])
        if "sharing" in data:
            self.sharing = bool(data["sharing"])
        if "follow" in data:
            self.following = str(data["follow"] or "")
        if "status_changed" in data and data["status_changed"] in STATUSES:
            self.my_status = data["status_changed"]
        if data.get("open_chat"):
            self.panel = "chat"
            self.unread = 0
            yield rx.set_focus("nook-chat-input")
        if "chat" in data and isinstance(data["chat"], dict):
            msg = data["chat"]
            entry = ChatLine(
                id=str(msg.get("id") or time.time()),
                name=tr(lang, "you") if msg.get("mine") else str(msg.get("name") or "?"),
                text=str(msg.get("text") or "")[:2000],
                scope="nearby" if msg.get("scope") == "nearby" else "all",
                mine=bool(msg.get("mine")),
                time=time.strftime("%H:%M"),
            )
            self.chat = (self.chat + [entry])[-CHAT_KEEP:]
            if self.panel != "chat" and not msg.get("mine"):
                self.unread += 1
        if "waved" in data:
            yield rx.toast.info(tr(lang, "waved_at_you", name=str(data["waved"])), duration=4000)
        if "interact" in data and isinstance(data["interact"], dict):
            it = data["interact"]
            self.dialog_kind = str(it.get("kind") or "")
            self.dialog_index = int(it.get("index") or 0)
            self.dialog_label = str(it.get("label") or "")
            self.dialog_text = str(it.get("text") or "")
            self.dialog_url = str(it.get("url") or "")
            self.dialog_editing = self.dialog_kind == "board" and not self.dialog_text
        if "editor" in data and isinstance(data["editor"], dict):
            ed = data["editor"]
            sel = ed.get("selected") if isinstance(ed.get("selected"), dict) else {}
            self.ed_dirty = bool(ed.get("dirty"))
            self.ed_undo = int(ed.get("undo") or 0)
            self.ed_tool = str(ed.get("tool") or self.ed_tool)
            self.ed_option = str(ed.get("option") or self.ed_option)
            self.ed_picking = bool(ed.get("picking"))
            self.ed_sel_kind = str(sel.get("kind") or "")
            self.ed_sel_type = str(sel.get("type") or "")
            self.ed_sel_turns = bool(sel.get("turns"))
            self.ed_sel_portal = bool(sel.get("portal"))
            self.ed_sel_to = str(sel.get("to") or "")
            self.ed_sel_name = str(sel.get("name") or "")
            self.ed_sel_area_kind = str(sel.get("area_kind") or "")
        if "map_changed" in data:
            yield SpaceState.reload_map(int(data["map_changed"] or 0))
