"""A space: the pre-join screen, then the map with the toolbar around it.

The map canvas, the video tiles at the top and your own picture are owned by
the browser part (assets/nooklane/*.js); this page only gives them a place
(``#nook-map-host``, ``#nook-strip-host``, ``#nook-self-host`` /
``#nook-preview-host``) and draws the controls around them.
"""

import reflex as rx

from nooklane.pages.common import FONT, INPUT, PRIMARY, SECONDARY, T, error_box, lang_toggle, sprite
from nooklane.pages.editor import build_panel
from nooklane.states.space import BRIDGE_ID, LOOK_PARTS, ChatLine, Person, SpaceState

S = SpaceState

_MODE_ICONS = {"avatar": "smile", "face": "scan-face", "full": "video", "off": "video-off"}
_STATUS_DOT = {"available": "bg-green-500", "busy": "bg-red-500", "away": "bg-amber-400"}
# Reactions on keys 1-7, as in Gather (assets/nooklane/client.js EMOTES).
_EMOTES = ["👋", "❤️", "🎉", "👍", "🤣", "👏", "💯"]


def bridge_input() -> rx.Component:
    return rx.el.input(id=BRIDGE_ID, class_name="hidden", on_change=S.handle_js)


# --- pre-join ------------------------------------------------------------------------------


def mode_button(mode: str) -> rx.Component:
    selected = S.mode_now == mode
    return rx.el.button(
        rx.icon(_MODE_ICONS[mode], class_name="h-4 w-4"),
        rx.el.span(T[f"mode_{mode}"], class_name="text-xs font-bold"),
        type="button",
        on_click=S.set_mode(mode),
        custom_attrs={"data-mode": mode, "aria-pressed": rx.cond(selected, "true", "false")},
        class_name=rx.cond(
            selected,
            "flex-1 flex flex-col items-center gap-1 py-2 rounded-xl bg-teal-600 text-white shadow-sm",
            "flex-1 flex flex-col items-center gap-1 py-2 rounded-xl bg-white text-gray-700 border border-gray-200 hover:border-teal-400",
        ),
    )


def style_choice(style: str) -> rx.Component:
    selected = S.style_now == style
    return rx.el.button(
        rx.el.canvas(custom_attrs={"data-nook-avatar-style": style}, class_name="w-full aspect-square rounded-lg"),
        rx.el.span(T[f"style_{style}"], class_name="text-[11px] font-bold text-gray-700"),
        type="button",
        on_click=S.set_style(style),
        custom_attrs={"data-style": style},
        class_name=rx.cond(
            selected,
            "flex flex-col items-center gap-0.5 p-1 rounded-xl ring-2 ring-teal-500 bg-teal-50",
            "flex flex-col items-center gap-0.5 p-1 rounded-xl ring-1 ring-gray-200 hover:ring-teal-300",
        ),
    )


def look_row(index: int, part: str) -> rx.Component:
    arrow = "p-1 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-900"
    return rx.el.div(
        rx.el.button(rx.icon("chevron-left", class_name="h-4 w-4"), type="button", on_click=S.cycle_part(index, -1), class_name=arrow),
        rx.el.span(T[f"part_{part}"], class_name="flex-1 text-center text-xs font-bold text-gray-700"),
        rx.el.button(rx.icon("chevron-right", class_name="h-4 w-4"), type="button", on_click=S.cycle_part(index, 1), class_name=arrow,
                     custom_attrs={"data-part": part}),
        class_name="flex items-center gap-1",
    )


def prejoin_view() -> rx.Component:
    return rx.el.div(
        rx.el.div(
            # Left: what others will see.
            rx.el.div(
                rx.el.div(
                    rx.el.div(id="nook-preview-host", class_name="absolute inset-0"),
                    rx.el.button(
                        rx.cond(S.mic_wanted, rx.icon("mic", class_name="h-4 w-4"), rx.icon("mic-off", class_name="h-4 w-4")),
                        rx.cond(S.mic_wanted, T["mic_on"], T["mic_off"]),
                        type="button",
                        on_click=S.toggle_mic_pref,
                        id="prejoin-mic",
                        class_name=rx.cond(
                            S.mic_wanted,
                            "absolute left-3 bottom-3 flex items-center gap-1.5 text-xs font-bold bg-black/55 text-white px-2.5 py-1.5 rounded-lg",
                            "absolute left-3 bottom-3 flex items-center gap-1.5 text-xs font-bold bg-red-600 text-white px-2.5 py-1.5 rounded-lg",
                        ),
                    ),
                    class_name="relative aspect-[4/3] rounded-2xl overflow-hidden bg-[#1d2230] shadow-inner",
                ),
                rx.el.p(T["camera_title"], class_name="text-sm font-extrabold text-gray-800 mt-4 mb-2"),
                rx.el.div(*[mode_button(m) for m in ("avatar", "face", "full", "off")], class_name="flex gap-2"),
                rx.el.p(S.mode_desc, id="mode-desc", class_name="text-xs text-gray-500 mt-2 leading-snug min-h-[2.5rem]"),
                rx.cond(
                    S.mode_now == "avatar",
                    rx.el.div(*[style_choice(s) for s in ("human", "cat", "panda", "robot")], class_name="grid grid-cols-4 gap-2 mt-1"),
                    rx.fragment(),
                ),
                class_name="w-full md:w-[46%]",
            ),
            # Right: who you are.
            rx.el.form(
                rx.el.div(
                    rx.el.h1(S.join_title, class_name="text-2xl font-black text-gray-900 leading-tight"),
                    lang_toggle(),
                    class_name="flex items-start justify-between gap-3",
                ),
                rx.el.div(
                    rx.el.label(T["your_name"], class_name="block text-sm font-bold text-gray-700 mb-1"),
                    rx.el.input(
                        name="name",
                        default_value=S.name,
                        key=S.name,
                        placeholder=T["name_placeholder"],
                        max_length=40,
                        on_blur=S.set_name,
                        id="join-name",
                        class_name=INPUT,
                    ),
                    class_name="mt-4",
                ),
                rx.el.div(
                    rx.el.p(T["your_character"], class_name="text-sm font-bold text-gray-700 mb-2"),
                    rx.el.div(
                        rx.el.div(
                            sprite(S.look_now, "w-24 h-32", walk=True),
                            rx.el.button(
                                rx.icon("shuffle", class_name="h-3.5 w-3.5"),
                                T["random"],
                                type="button",
                                on_click=S.shuffle_look,
                                class_name="text-[11px] font-bold text-teal-700 hover:underline flex items-center gap-1",
                            ),
                            class_name="flex flex-col items-center gap-1 bg-[#e9e4d6] rounded-2xl px-3 py-2",
                        ),
                        rx.el.div(
                            *[look_row(i, part) for i, (part, _) in enumerate(LOOK_PARTS)],
                            class_name="flex-1 grid grid-cols-1 gap-0.5",
                        ),
                        class_name="flex gap-3 items-center",
                    ),
                    class_name="mt-4",
                ),
                rx.cond(S.error != "", rx.el.div(error_box(S.error), class_name="mt-4"), rx.fragment()),
                rx.el.button(
                    rx.cond(S.joining, rx.spinner(size="2"), rx.icon("log-in", class_name="h-5 w-5")),
                    rx.cond(S.joining, T["joining"], T["join"]),
                    type="submit",
                    disabled=S.joining,
                    id="join-button",
                    class_name=PRIMARY + " w-full mt-5 py-3 text-lg",
                ),
                rx.el.a(
                    rx.icon("arrow-left", class_name="h-4 w-4"),
                    T["back_lobby"],
                    href="/",
                    class_name="mt-4 inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-teal-700",
                ),
                on_submit=S.join,
                reset_on_submit=False,
                class_name="w-full md:flex-1 flex flex-col",
            ),
            class_name="w-full max-w-4xl bg-white/95 rounded-3xl shadow-2xl p-5 sm:p-7 flex flex-col md:flex-row gap-6",
        ),
        class_name="absolute inset-0 overflow-y-auto flex items-start md:items-center justify-center p-4 bg-[#1b1f29]/55 backdrop-blur-[3px] z-20",
    )


# --- in the space ------------------------------------------------------------------------------


def tool_button(icon_on: str, label: rx.Var, on_click, *, active=None, danger=None, badge=None, icon_off: str = "", off=None, button_id: str = "") -> rx.Component:
    base = "relative h-11 min-w-11 px-2.5 rounded-xl flex items-center justify-center gap-1.5 transition-colors text-sm font-bold"
    if off is not None:
        cls = rx.cond(off, f"{base} bg-red-500/90 hover:bg-red-500 text-white", f"{base} bg-white/10 hover:bg-white/20 text-white")
        icon = rx.cond(off, rx.icon(icon_off or icon_on, class_name="h-5 w-5"), rx.icon(icon_on, class_name="h-5 w-5"))
    elif active is not None:
        cls = rx.cond(active, f"{base} bg-teal-500 text-white", f"{base} bg-white/10 hover:bg-white/20 text-white")
        icon = rx.icon(icon_on, class_name="h-5 w-5")
    elif danger:
        cls = f"{base} bg-red-600 hover:bg-red-700 text-white"
        icon = rx.icon(icon_on, class_name="h-5 w-5")
    else:
        cls = f"{base} bg-white/10 hover:bg-white/20 text-white"
        icon = rx.icon(icon_on, class_name="h-5 w-5")
    children = [icon]
    if badge is not None:
        children.append(badge)
    return rx.tooltip(
        rx.el.button(*children, on_click=on_click, id=button_id or None, class_name=cls, custom_attrs={"aria-label": label}),
        content=label,
    )


def count_badge(value: rx.Var, show: rx.Var) -> rx.Component:
    return rx.cond(
        show,
        rx.el.span(value, class_name="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-red-500 text-white text-[11px] font-black flex items-center justify-center"),
        rx.fragment(),
    )


def mode_menu() -> rx.Component:
    def item(mode: str) -> rx.Component:
        return rx.menu.item(
            rx.icon(_MODE_ICONS[mode], class_name="h-4 w-4"),
            T[f"mode_{mode}"],
            on_click=S.set_mode(mode),
            custom_attrs={"data-mode-item": mode},
        )

    return rx.menu.root(
        rx.menu.trigger(
            rx.el.button(
                rx.match(
                    S.mode_now,
                    *[(m, rx.icon(icon, class_name="h-5 w-5")) for m, icon in _MODE_ICONS.items()],
                    rx.icon("video", class_name="h-5 w-5"),
                ),
                rx.el.span(rx.match(S.mode_now, *[(m, T[f"mode_{m}"]) for m in _MODE_ICONS], T["mode_off"]), class_name="hidden lg:inline whitespace-nowrap"),
                rx.icon("chevron-up", class_name="h-3.5 w-3.5 opacity-70"),
                id="mode-menu",
                class_name=rx.cond(
                    S.mode_now == "off",
                    "h-11 px-2.5 rounded-xl flex items-center gap-1.5 bg-red-500/90 hover:bg-red-500 text-white text-sm font-bold",
                    "h-11 px-2.5 rounded-xl flex items-center gap-1.5 bg-white/10 hover:bg-white/20 text-white text-sm font-bold",
                ),
            ),
        ),
        rx.menu.content(*[item(m) for m in ("avatar", "face", "full", "off")], side="top", class_name=FONT),
    )


def status_menu() -> rx.Component:
    def item(status: str) -> rx.Component:
        return rx.menu.item(
            rx.el.span(class_name=f"size-2.5 rounded-full {_STATUS_DOT[status]}"),
            T[f"status_{status}"],
            on_click=S.set_status(status),
        )

    return rx.menu.root(
        rx.menu.trigger(
            rx.el.button(
                rx.el.span(class_name=rx.match(S.my_status, *[(k, f"size-2.5 rounded-full {v}") for k, v in _STATUS_DOT.items()], "size-2.5 rounded-full bg-green-500")),
                rx.el.span(S.name, class_name="truncate max-w-[7rem]"),
                rx.icon("chevron-up", class_name="h-3 w-3 opacity-60"),
                id="status-menu",
                class_name="flex items-center gap-1.5 text-white text-xs font-bold px-2 py-1 rounded-lg hover:bg-white/10",
            ),
        ),
        rx.menu.content(*[item(s) for s in ("available", "busy", "away")], side="top", class_name=FONT),
    )


def reactions_popover() -> rx.Component:
    return rx.popover.root(
        rx.popover.trigger(
            rx.el.button(
                rx.icon("smile-plus", class_name="h-5 w-5"),
                rx.cond(S.hand, rx.el.span("✋", class_name="text-base"), rx.fragment()),
                id="reactions",
                class_name="h-11 min-w-11 px-2.5 rounded-xl flex items-center justify-center gap-1 bg-white/10 hover:bg-white/20 text-white",
                custom_attrs={"aria-label": T["reactions"]},
            ),
        ),
        rx.popover.content(
            rx.el.div(
                *[
                    rx.el.button(
                        rx.el.span(e, class_name="text-2xl"),
                        rx.el.span(str(i + 1), class_name="text-[10px] font-bold text-gray-400"),
                        on_click=S.emote(i),
                        class_name="flex flex-col items-center px-2 py-1 rounded-lg hover:bg-gray-100",
                    )
                    for i, e in enumerate(_EMOTES)
                ],
                rx.el.button(
                    rx.el.span("✋", class_name="text-2xl"),
                    rx.el.span(rx.cond(S.hand, T["lower_hand"], T["raise_hand"]), " (H)", class_name="text-[10px] font-bold text-gray-500 whitespace-nowrap"),
                    on_click=S.toggle_hand,
                    id="hand-button",
                    class_name=rx.cond(S.hand, "flex flex-col items-center px-2 py-1 rounded-lg bg-amber-100", "flex flex-col items-center px-2 py-1 rounded-lg hover:bg-gray-100"),
                ),
                class_name="flex items-end gap-1",
            ),
            side="top",
            class_name=FONT,
        ),
    )


def more_menu() -> rx.Component:
    return rx.menu.root(
        rx.menu.trigger(
            rx.el.button(
                rx.icon("ellipsis", class_name="h-5 w-5"),
                id="more-menu",
                class_name="h-11 w-11 rounded-xl flex items-center justify-center bg-white/10 hover:bg-white/20 text-white",
                custom_attrs={"aria-label": T["more"]},
            ),
        ),
        rx.menu.content(
            rx.menu.item(rx.icon("zoom-in", class_name="h-4 w-4"), T["zoom_in"], on_click=S.zoom(1), close_on_select=False),
            rx.menu.item(rx.icon("zoom-out", class_name="h-4 w-4"), T["zoom_out"], on_click=S.zoom(-1), close_on_select=False),
            rx.menu.item(
                rx.cond(S.ring_on, rx.icon("circle-check", class_name="h-4 w-4"), rx.icon("circle", class_name="h-4 w-4")),
                T["show_ring"],
                on_click=S.toggle_ring,
            ),
            rx.menu.item(
                rx.cond(S.minimap_on, rx.icon("circle-check", class_name="h-4 w-4"), rx.icon("circle", class_name="h-4 w-4")),
                T["show_minimap"],
                on_click=S.toggle_minimap,
            ),
            rx.menu.item(rx.icon("map-pin", class_name="h-4 w-4"), T["respawn"], on_click=S.respawn),
            rx.menu.separator(),
            rx.menu.item(rx.icon("link", class_name="h-4 w-4"), T["copy_invite"], on_click=S.copy_invite),
            rx.menu.item(rx.icon("languages", class_name="h-4 w-4"), T["lang_other"], on_click=S.toggle_lang),
            side="top",
            class_name=FONT,
        ),
    )


def toolbar() -> rx.Component:
    divider = rx.el.div(class_name="w-px h-8 bg-white/15 mx-0.5")
    return rx.el.div(
        rx.el.div(
            rx.el.div(id="nook-self-host", class_name="absolute inset-0"),
            rx.cond(S.mic_on, rx.fragment(), rx.el.div(rx.icon("mic-off", class_name="h-3 w-3"), class_name="absolute right-1 top-1 bg-red-500 text-white p-0.5 rounded")),
            class_name="relative w-[104px] h-[78px] rounded-xl overflow-hidden bg-[#2b3346] shrink-0",
        ),
        rx.el.div(
            status_menu(),
            rx.el.div(
                tool_button("mic", rx.cond(S.mic_on, T["mute"], T["unmute"]), S.toggle_mic, off=~S.mic_on, icon_off="mic-off", button_id="mic-button"),
                mode_menu(),
                tool_button("monitor-up", rx.cond(S.sharing, T["stop_share"], T["share_screen"]), S.toggle_share, active=S.sharing, button_id="share-button"),
                reactions_popover(),
                divider,
                tool_button("message-circle", T["chat"], S.toggle_panel("chat"), active=S.panel == "chat",
                            badge=count_badge(S.unread, S.unread > 0), button_id="chat-button"),
                tool_button("users", T["people"], S.toggle_panel("people"), active=S.panel == "people",
                            badge=rx.el.span(S.people_count, class_name="text-xs"), button_id="people-button"),
                tool_button("layout-grid", rx.cond(S.meeting_view, T["map_view"], T["meeting_view"]), S.toggle_meeting_view,
                            active=S.meeting_view, button_id="meeting-button"),
                tool_button("hammer", T["build"], S.toggle_panel("build"), active=S.panel == "build", button_id="build-button"),
                more_menu(),
                tool_button("log-out", T["leave"], S.leave, danger=True, button_id="leave-button"),
                class_name="flex items-center gap-1.5",
            ),
            class_name="flex flex-col gap-1",
        ),
        id="toolbar",
        class_name="absolute bottom-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2.5 bg-[#1b1f29]/92 backdrop-blur px-2.5 py-2 rounded-2xl shadow-2xl max-w-[calc(100vw-1.5rem)] overflow-x-auto",
    )


def top_left() -> rx.Component:
    return rx.el.div(
        rx.el.a(rx.icon("arrow-left", class_name="h-4 w-4"), href="/", class_name="p-1.5 rounded-lg hover:bg-white/15 text-white",
                custom_attrs={"aria-label": T["back_lobby"]}),
        rx.el.div(
            rx.el.p(S.space_name, class_name="text-sm font-extrabold text-white truncate max-w-[14rem]"),
            rx.el.p(S.people_label, class_name="text-[11px] text-white/70"),
            class_name="min-w-0",
        ),
        rx.cond(
            S.area != "",
            rx.el.span(rx.icon("lock", class_name="h-3 w-3"), S.area, id="area-chip",
                       class_name="flex items-center gap-1 text-[11px] font-bold bg-teal-500 text-white px-2 py-1 rounded-lg"),
            rx.fragment(),
        ),
        class_name="absolute left-3 top-3 z-30 flex items-center gap-2 bg-[#1b1f29]/85 backdrop-blur px-2 py-1.5 rounded-xl shadow-lg",
    )


def banners() -> rx.Component:
    return rx.el.div(
        rx.cond(
            S.audio_blocked,
            rx.el.button(rx.icon("volume-2", class_name="h-4 w-4"), T["enable_audio"], on_click=S.enable_audio, id="enable-audio",
                         class_name="flex items-center gap-2 bg-amber-400 text-amber-950 font-bold text-sm px-3 py-2 rounded-xl shadow-lg"),
            rx.fragment(),
        ),
        rx.cond(
            S.ghost,
            rx.el.div(rx.icon("ghost", class_name="h-4 w-4"), T["ghost_on"], id="ghost-banner",
                      class_name="flex items-center gap-2 bg-violet-600/90 text-white text-xs font-bold px-3 py-2 rounded-xl"),
            rx.fragment(),
        ),
        rx.cond(
            S.following_label != "",
            rx.el.div(rx.icon("footprints", class_name="h-4 w-4"), S.following_label,
                      class_name="flex items-center gap-2 bg-[#1b1f29]/90 text-white text-xs font-bold px-3 py-2 rounded-xl"),
            rx.fragment(),
        ),
        class_name="absolute left-1/2 -translate-x-1/2 top-[160px] z-30 flex flex-col items-center gap-2 pointer-events-auto",
    )


def chat_panel() -> rx.Component:
    def scope_tab(scope: str, key: str) -> rx.Component:
        return rx.el.button(
            T[key],
            on_click=S.set_chat_scope(scope),
            custom_attrs={"data-scope": scope},
            class_name=rx.cond(S.chat_scope == scope, "flex-1 py-1.5 rounded-lg bg-white shadow-sm text-sm font-bold text-gray-900",
                               "flex-1 py-1.5 rounded-lg text-sm font-semibold text-gray-500"),
        )

    def message(m: ChatLine) -> rx.Component:
        return rx.el.div(
            rx.el.div(
                rx.el.span(m.name, class_name="text-xs font-extrabold text-gray-800"),
                rx.cond(m.scope == "nearby", rx.el.span(T["nearby_tag"], class_name="text-[10px] font-bold text-teal-700 bg-teal-50 px-1.5 rounded"), rx.fragment()),
                rx.el.span(m.time, class_name="text-[10px] text-gray-400 ml-auto"),
                class_name="flex items-center gap-1.5",
            ),
            rx.el.p(m.text, class_name="text-sm text-gray-800 whitespace-pre-wrap break-words"),
            class_name=rx.cond(m.mine, "chat-msg bg-teal-50 rounded-xl px-3 py-2", "chat-msg bg-gray-50 rounded-xl px-3 py-2"),
        )

    return rx.el.div(
        rx.el.div(scope_tab("nearby", "chat_nearby"), scope_tab("all", "chat_everyone"), class_name="flex gap-1 bg-gray-100 p-1 rounded-xl"),
        rx.auto_scroll(
            rx.cond(S.chat.length() > 0, rx.foreach(S.chat, message), rx.el.p(T["chat_empty"], class_name="text-sm text-gray-400 text-center py-8")),
            id="chat-list",
            class_name="flex-1 min-h-0 flex flex-col gap-2 py-3",
        ),
        rx.cond(S.nobody_near, rx.el.p(T["chat_nobody_near"], class_name="text-xs text-amber-700 bg-amber-50 rounded-lg px-2 py-1.5 mb-2"), rx.fragment()),
        rx.el.form(
            rx.el.input(name="message", placeholder=S.chat_placeholder, auto_complete="off", id="nook-chat-input", class_name=INPUT + " text-sm"),
            rx.el.button(rx.icon("send", class_name="h-4 w-4"), type="submit", class_name=PRIMARY + " px-3", custom_attrs={"aria-label": T["send"]}),
            on_submit=S.send_chat,
            reset_on_submit=True,
            class_name="flex gap-2",
        ),
        class_name="flex flex-col h-full min-h-0",
    )


def person_row(p: Person) -> rx.Component:
    action = "p-1.5 rounded-lg text-gray-500 hover:text-teal-700 hover:bg-teal-50"
    return rx.el.div(
        sprite(p.look, "w-7 h-9 shrink-0"),
        rx.el.div(
            rx.el.div(
                rx.el.span(class_name=rx.match(p.status, *[(k, f"size-2 rounded-full shrink-0 {v}") for k, v in _STATUS_DOT.items()], "size-2 rounded-full bg-green-500")),
                rx.el.span(p.name, class_name="text-sm font-bold text-gray-900 truncate"),
                rx.cond(p.local, rx.el.span("(" + T["you"] + ")", class_name="text-xs text-gray-400 shrink-0"), rx.fragment()),
                rx.cond(p.muted, rx.icon("mic-off", class_name="h-3.5 w-3.5 text-red-400 shrink-0"), rx.fragment()),
                rx.cond(p.hand, rx.el.span("✋", class_name="text-sm"), rx.fragment()),
                class_name="flex items-center gap-1.5 min-w-0",
            ),
            rx.el.p(
                rx.cond(p.where != "", p.where, rx.cond(p.near & ~p.local, T["near_you"], "")),
                class_name="text-[11px] text-gray-500 truncate",
            ),
            class_name="flex-1 min-w-0",
        ),
        rx.cond(
            p.local,
            rx.fragment(),
            rx.el.div(
                rx.tooltip(rx.el.button(rx.icon("crosshair", class_name="h-4 w-4"), on_click=S.locate(p.identity), class_name=action), content=T["locate"]),
                rx.tooltip(rx.el.button(rx.icon("footprints", class_name="h-4 w-4"), on_click=S.walk_to(p.identity), class_name=action,
                                        custom_attrs={"data-walk": p.identity}), content=T["walk_to"]),
                rx.tooltip(rx.el.button(rx.icon("user-round-check", class_name="h-4 w-4"), on_click=S.follow(p.identity),
                                        class_name=rx.cond(S.following == p.identity, "p-1.5 rounded-lg text-white bg-teal-600", action)),
                           content=rx.cond(S.following == p.identity, T["unfollow"], T["follow"])),
                rx.tooltip(rx.el.button(rx.icon("hand", class_name="h-4 w-4"), on_click=S.wave(p.identity), class_name=action,
                                        custom_attrs={"data-wave": p.identity}), content=T["wave"]),
                class_name="flex items-center",
            ),
        ),
        custom_attrs={"data-person": p.identity},
        class_name="person-row flex items-center gap-2.5 px-2 py-1.5 rounded-xl hover:bg-gray-50",
    )


def people_panel() -> rx.Component:
    return rx.el.div(
        rx.foreach(S.people, person_row),
        id="people-list",
        class_name="flex flex-col gap-0.5 overflow-y-auto min-h-0",
    )


def side_panel() -> rx.Component:
    return rx.cond(
        S.panel != "",
        rx.el.div(
            rx.el.div(
                rx.el.h2(
                    rx.match(S.panel, ("chat", T["chat"]), ("people", T["people_title"]), ("build", T["build_title"]), ""),
                    class_name="text-base font-extrabold text-gray-900",
                ),
                rx.el.button(rx.icon("x", class_name="h-4 w-4"), on_click=S.close_panel, class_name="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"),
                class_name="flex items-center justify-between mb-3",
            ),
            rx.match(
                S.panel,
                ("chat", chat_panel()),
                ("people", people_panel()),
                ("build", build_panel()),
                rx.fragment(),
            ),
            id="side-panel",
            class_name="absolute right-3 top-3 bottom-[104px] z-30 w-[min(340px,calc(100vw-1.5rem))] bg-white rounded-2xl shadow-2xl p-3 flex flex-col",
        ),
        rx.fragment(),
    )


def zoom_buttons() -> rx.Component:
    btn = "h-9 w-9 flex items-center justify-center text-white hover:bg-white/15"
    return rx.el.div(
        rx.el.button(rx.icon("plus", class_name="h-4 w-4"), on_click=S.zoom(1), id="zoom-in", class_name=btn,
                     custom_attrs={"aria-label": T["zoom_in"]}),
        rx.el.div(class_name="h-px bg-white/15"),
        rx.el.button(rx.icon("minus", class_name="h-4 w-4"), on_click=S.zoom(-1), id="zoom-out", class_name=btn,
                     custom_attrs={"aria-label": T["zoom_out"]}),
        class_name="absolute right-3 bottom-[168px] z-20 flex flex-col rounded-xl overflow-hidden bg-[#1b1f29]/85 shadow-lg",
    )


def keys_help() -> rx.Component:
    return rx.el.p(T["keys_help"], class_name="hidden lg:block absolute left-3 top-[64px] z-20 text-[11px] text-white/85 bg-black/40 px-2.5 py-1.5 rounded-lg max-w-[19rem]")


def object_dialog() -> rx.Component:
    title = rx.cond(
        S.dialog_label != "",
        S.dialog_label,
        rx.match(S.dialog_kind, ("board", T["board_title"]), ("note", T["note_title"]), ("screen", T["screen_title"]), ""),
    )
    text_view = rx.cond(
        S.dialog_editing,
        rx.el.form(
            rx.el.textarea(name="text", default_value=S.dialog_text, key=S.dialog_index.to_string() + S.dialog_text,
                           rows=12, auto_focus=True, id="dialog-text", class_name=INPUT + " font-mono text-sm"),
            rx.el.div(
                rx.el.button(T["cancel"], type="button", on_click=S.close_dialog, class_name=SECONDARY),
                rx.el.button(rx.icon("save", class_name="h-4 w-4"), T["save"], type="submit", id="dialog-save", class_name=PRIMARY),
                class_name="flex justify-end gap-2 mt-3",
            ),
            on_submit=S.save_text,
            reset_on_submit=False,
        ),
        rx.el.div(
            rx.el.div(S.dialog_text, id="dialog-body", class_name="whitespace-pre-wrap text-gray-800 bg-[#fffbea] border border-amber-100 rounded-xl p-4 min-h-[8rem] max-h-[55vh] overflow-y-auto"),
            rx.el.div(
                rx.el.button(rx.icon("pencil", class_name="h-4 w-4"), T["edit"], on_click=S.start_edit, id="dialog-edit", class_name=SECONDARY),
                rx.el.button(T["close"], on_click=S.close_dialog, class_name=PRIMARY),
                class_name="flex justify-end gap-2 mt-3",
            ),
        ),
    )
    screen_view = rx.el.div(
        rx.cond(
            S.dialog_url != "",
            rx.el.div(
                rx.el.iframe(src=S.dialog_url, class_name="w-full h-[58vh] rounded-xl border border-gray-200 bg-white",
                             # The page shown can't navigate Nooklane itself away.
                             custom_attrs={"allow": "fullscreen; autoplay; clipboard-write",
                                           "sandbox": "allow-scripts allow-same-origin allow-forms allow-popups allow-presentation"}),
                rx.el.a(rx.icon("external-link", class_name="h-4 w-4"), T["open_new_tab"], href=S.dialog_url, target="_blank",
                        class_name="inline-flex items-center gap-1.5 text-sm text-teal-700 font-bold mt-2"),
            ),
            rx.el.p(T["screen_empty"], class_name="text-sm text-gray-600"),
        ),
        rx.el.form(
            rx.el.input(name="url", default_value=S.dialog_url, key=S.dialog_url, placeholder=T["screen_link"], id="dialog-url", class_name=INPUT + " text-sm"),
            rx.el.button(T["save"], type="submit", class_name=PRIMARY),
            on_submit=S.save_url,
            reset_on_submit=False,
            class_name="flex gap-2 mt-3",
        ),
    )
    return rx.dialog.root(
        rx.dialog.content(
            rx.dialog.title(title),
            rx.match(
                S.dialog_kind,
                ("board", text_view),
                ("note", text_view),
                ("screen", screen_view),
                ("portal", rx.el.div(rx.el.p(T["portal_nowhere"], class_name="text-sm text-gray-600"),
                                     rx.el.div(rx.el.button(T["close"], on_click=S.close_dialog, class_name=PRIMARY), class_name="flex justify-end mt-3"))),
                rx.fragment(),
            ),
            class_name=FONT,
            style={"maxWidth": rx.cond(S.dialog_kind == "screen", "min(960px, 94vw)", "560px")},
        ),
        open=S.dialog_kind != "",
        on_open_change=S.set_dialog_open,
    )


def in_space_ui() -> rx.Component:
    return rx.fragment(
        rx.el.div(id="nook-strip-host", class_name="absolute left-0 right-0 top-0 z-10 pointer-events-none"),
        # The minimap and the zoom buttons make way for the side panel.
        rx.cond(
            S.panel == "",
            rx.fragment(
                rx.el.div(id="nook-minimap-host", class_name="hidden lg:block absolute right-0 bottom-0 z-20"),
                zoom_buttons(),
            ),
            rx.fragment(),
        ),
        top_left(),
        banners(),
        side_panel(),
        keys_help(),
        toolbar(),
    )


def not_found_view() -> rx.Component:
    return rx.el.div(
        rx.el.div(
            rx.icon("map-pin-off", class_name="h-10 w-10 text-teal-600"),
            rx.el.h1(T["not_found_title"], class_name="text-2xl font-black text-gray-900"),
            rx.el.p(T["not_found_body"], class_name="text-gray-600"),
            rx.el.a(rx.icon("arrow-left", class_name="h-4 w-4"), T["back_lobby"], href="/", class_name=PRIMARY),
            class_name="bg-white rounded-3xl p-8 shadow-2xl flex flex-col items-center gap-3 text-center max-w-md",
        ),
        class_name="absolute inset-0 flex items-center justify-center p-4 z-20 bg-[#1b1f29]/70",
    )


def space_page() -> rx.Component:
    return rx.el.div(
        bridge_input(),
        rx.el.div(id="nook-map-host", class_name="absolute inset-0"),
        rx.cond(
            ~S.found,
            not_found_view(),
            rx.cond(S.joined, in_space_ui(), prejoin_view()),
        ),
        object_dialog(),
        class_name=f"fixed inset-0 overflow-hidden bg-[#262a33] {FONT}",
    )
