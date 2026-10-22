"""Nooklane: a self-hosted 2D place where people walk up to each other to talk.

Pages:
    /            spaces on this server, templates for a new one
    /s/<id>      a space: pre-join, then the map with voices and cameras
    /settings    the embedded LiveKit server (status; admin with ADMIN_PASSCODE)
"""

import reflex as rx

from nooklane import livekit_server
from nooklane.api import register_api_routes
from nooklane.livekit_proxy import register_livekit_routes
from nooklane.pages.lobby import lobby_page
from nooklane.pages.settings import settings_page
from nooklane.pages.space import space_page
from nooklane.states.lang import LangState
from nooklane.states.lobby import LobbyState
from nooklane.states.server_state import ServerStatusState
from nooklane.states.settings_state import SettingsState
from nooklane.states.space import SpaceState
from nooklane.static_pages import serve_pages_without_slash_redirect

# Bump when a script in assets/ changes, so browsers drop their cached copies.
_JS_VERSION = "4"
_SCRIPTS = (
    "/livekit-client.umd.js",
    f"/avatar_face.js?v={_JS_VERSION}",
    f"/face_tracker.js?v={_JS_VERSION}",
    f"/nooklane/art.js?v={_JS_VERSION}",
    f"/nooklane/world.js?v={_JS_VERSION}",
    f"/nooklane/media.js?v={_JS_VERSION}",
    f"/nooklane/editor.js?v={_JS_VERSION}",
    f"/nooklane/client.js?v={_JS_VERSION}",
    f"/nooklane/previews.js?v={_JS_VERSION}",
)


def _head() -> list[rx.Component]:
    api = rx.config.get_config().api_url.rstrip("/")
    return [
        rx.el.link(rel="preconnect", href="https://fonts.googleapis.com"),
        rx.el.link(rel="preconnect", href="https://fonts.gstatic.com", cross_origin=""),
        rx.el.link(
            href="https://fonts.googleapis.com/css2?family=Nunito:wght@400..900&display=swap",
            rel="stylesheet",
        ),
        # Where the browser fetches map JSON for thumbnails (same origin behind re-ddns).
        rx.el.meta(name="nook-api", content=api),
        # Served from assets/: no CDN, so spaces work on an offline LAN too.
        *[rx.el.script(src=src) for src in _SCRIPTS],
    ]


app = rx.App(
    api_transformer=serve_pages_without_slash_redirect,
    head_components=_head(),
)
app.add_page(
    lobby_page,
    route="/",
    title="Nooklane",
    on_load=[LangState.init_lang, LobbyState.on_load, ServerStatusState.watch],
)
app.add_page(
    space_page,
    route="/s/[space_id]",
    title="Nooklane",
    on_load=[SpaceState.on_load, ServerStatusState.watch],
)
app.add_page(rx.fragment, route="/s", on_load=rx.redirect("/"))
app.add_page(
    settings_page,
    route="/settings",
    title="Nooklane · LiveKit Server",
    on_load=[LangState.init_lang, SettingsState.on_settings_load, ServerStatusState.watch],
)

# The embedded LiveKit server, the /rtc and /twirp relays to it, and map JSON.
app.register_lifespan_task(livekit_server.lifespan)
register_livekit_routes(app)
register_api_routes(app)
