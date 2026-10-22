"""The front page: spaces on this server, and templates for a new one."""

import reflex as rx

from nooklane.pages.common import FONT, INPUT, PRIMARY, SECONDARY, T, error_box, lang_toggle, logo, server_pill, sprite
from nooklane.states.lobby import LobbyState, SpaceCard

_CATEGORY_ICON = {
    "office": "briefcase",
    "social": "coffee",
    "event": "mic",
    "education": "graduation-cap",
    "build": "hammer",
}


def space_card(space: SpaceCard) -> rx.Component:
    return rx.el.a(
        rx.el.div(
            rx.el.canvas(custom_attrs={"data-nook-thumb": space.thumb}, class_name="w-full h-full"),
            rx.el.div(
                rx.el.span(class_name=rx.cond(space.people > 0, "size-2 rounded-full bg-green-400", "size-2 rounded-full bg-gray-300")),
                space.inside,
                class_name="absolute left-2 top-2 flex items-center gap-1.5 text-xs font-bold text-white bg-black/55 px-2 py-1 rounded-lg",
            ),
            class_name="relative aspect-[16/9] rounded-xl overflow-hidden bg-[#262a33]",
        ),
        rx.el.div(
            rx.el.div(
                rx.el.p(space.name, class_name="font-extrabold text-gray-900 truncate"),
                rx.el.p(space.kind, class_name="text-xs text-gray-500 truncate"),
                class_name="min-w-0",
            ),
            rx.el.span(T["enter"], rx.icon("arrow-right", class_name="h-4 w-4"),
                       class_name="shrink-0 inline-flex items-center gap-1 text-sm font-bold text-teal-700"),
            class_name="flex items-center justify-between gap-3 pt-3",
        ),
        href=space.href,
        custom_attrs={"data-space": space.id},
        class_name="space-card block bg-white p-3 rounded-2xl border border-gray-100 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all",
    )


def template_card(t: dict) -> rx.Component:
    return rx.el.button(
        rx.el.div(
            rx.el.canvas(custom_attrs={"data-nook-thumb": "/_nooklane/template/" + t["id"]}, class_name="w-full h-full"),
            class_name="aspect-[16/10] rounded-xl overflow-hidden bg-[#262a33]",
        ),
        rx.el.div(
            rx.el.div(
                rx.match(
                    t["category"],
                    *[(cat, rx.icon(icon, class_name="h-4 w-4 text-teal-600 shrink-0")) for cat, icon in _CATEGORY_ICON.items()],
                    rx.icon("map", class_name="h-4 w-4 text-teal-600 shrink-0"),
                ),
                rx.el.p(t["name"], class_name="font-extrabold text-gray-900"),
                rx.cond(
                    t["people"] != "",
                    rx.el.span(t["people"], class_name="ml-auto text-[11px] font-bold text-teal-800 bg-teal-50 px-2 py-0.5 rounded-full shrink-0"),
                    rx.fragment(),
                ),
                class_name="flex items-center gap-2",
            ),
            rx.el.p(t["about"], class_name="text-sm text-gray-600 mt-1 leading-snug text-left"),
            class_name="pt-3",
        ),
        on_click=LobbyState.open_create(t["id"]),
        custom_attrs={"data-template": t["id"]},
        class_name="template-card text-left bg-white p-3 rounded-2xl border border-gray-100 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all",
    )


def create_dialog() -> rx.Component:
    return rx.dialog.root(
        rx.dialog.content(
            rx.dialog.title(T["create_title"], " ", LobbyState.create_template_name),
            rx.el.form(
                rx.el.div(
                    rx.el.label(T["space_name"], class_name="block text-sm font-bold text-gray-700 mb-1"),
                    rx.el.input(
                        name="name",
                        default_value=LobbyState.create_template_name,
                        key=LobbyState.create_template,
                        auto_focus=True,
                        max_length=60,
                        id="create-name",
                        class_name=INPUT,
                    ),
                    rx.el.p(T["create_hint"], class_name="text-xs text-gray-500 mt-2"),
                    rx.cond(LobbyState.create_error != "", error_box(LobbyState.create_error), rx.fragment()),
                    class_name="space-y-2",
                ),
                rx.el.div(
                    rx.dialog.close(rx.el.button(T["cancel"], type="button", class_name=SECONDARY)),
                    rx.el.button(
                        rx.cond(LobbyState.creating, rx.spinner(size="1"), rx.icon("sparkles", class_name="h-4 w-4")),
                        T["create"],
                        type="submit",
                        disabled=LobbyState.creating,
                        id="create-submit",
                        class_name=PRIMARY,
                    ),
                    class_name="flex justify-end gap-2 mt-5",
                ),
                on_submit=LobbyState.create_space,
                reset_on_submit=False,
            ),
            class_name=FONT,
        ),
        open=LobbyState.create_open,
        on_open_change=LobbyState.set_create_open,
    )


def how_item(icon: str, key: str) -> rx.Component:
    return rx.el.div(
        rx.el.div(rx.icon(icon, class_name="h-5 w-5 text-teal-700"), class_name="size-10 rounded-xl bg-teal-50 flex items-center justify-center shrink-0"),
        rx.el.p(T[key], class_name="text-sm text-gray-700 leading-snug"),
        class_name="flex items-start gap-3",
    )


def lobby_page() -> rx.Component:
    walkers = ["1-0-0-0-0-0", "3-1-6-6-0-4", "0-3-4-1-2-1", "4-2-0-7-5-0", "2-4-8-4-1-3"]
    return rx.el.div(
        rx.el.header(
            rx.el.div(
                logo(),
                rx.el.span("Nooklane", class_name="text-xl font-black text-gray-900 tracking-tight"),
                class_name="flex items-center gap-2.5",
            ),
            rx.el.div(server_pill(), lang_toggle(), class_name="flex items-center gap-2"),
            class_name="max-w-6xl mx-auto flex items-center justify-between gap-3 px-4 sm:px-6 py-4",
        ),
        rx.el.main(
            rx.el.section(
                rx.el.div(
                    rx.el.h1("Nooklane", class_name="text-4xl sm:text-5xl font-black text-gray-900 tracking-tight"),
                    rx.el.p(T["tagline"], class_name="text-lg text-gray-600 mt-3 max-w-xl leading-relaxed"),
                    rx.el.div(
                        *[sprite(look, "w-12 h-16", walk=True) for look in walkers],
                        class_name="flex items-end gap-1 mt-6",
                    ),
                    class_name="py-6",
                ),
                class_name="",
            ),
            rx.el.section(
                rx.el.h2(T["spaces_title"], class_name="text-xl font-extrabold text-gray-900 mb-4"),
                rx.cond(
                    LobbyState.spaces.length() > 0,
                    rx.el.div(
                        rx.foreach(LobbyState.spaces, space_card),
                        id="space-list",
                        class_name="grid sm:grid-cols-2 lg:grid-cols-3 gap-4",
                    ),
                    rx.el.p(T["spaces_empty"], class_name="text-gray-500"),
                ),
                class_name="mt-4",
            ),
            rx.el.section(
                rx.el.h2(T["new_title"], class_name="text-xl font-extrabold text-gray-900"),
                rx.el.p(T["new_hint"], class_name="text-sm text-gray-500 mb-4"),
                rx.el.div(
                    rx.foreach(LobbyState.templates, template_card),
                    id="template-list",
                    class_name="grid sm:grid-cols-2 lg:grid-cols-3 gap-4",
                ),
                class_name="mt-12",
            ),
            rx.el.section(
                rx.el.h2(T["how_title"], class_name="text-xl font-extrabold text-gray-900 mb-4"),
                rx.el.div(
                    how_item("footprints", "how_walk"),
                    how_item("audio-lines", "how_near"),
                    how_item("lock", "how_nook"),
                    how_item("smile", "how_face"),
                    class_name="grid sm:grid-cols-2 gap-5 bg-white p-5 rounded-2xl border border-gray-100",
                ),
                class_name="mt-12",
            ),
            rx.el.footer(
                rx.el.a(T["server_settings"], href="/settings", class_name="text-sm text-gray-500 hover:text-teal-700"),
                class_name="py-10 text-center",
            ),
            class_name="max-w-6xl mx-auto px-4 sm:px-6",
        ),
        create_dialog(),
        class_name=f"min-h-screen bg-[#f6f3ec] {FONT}",
    )
