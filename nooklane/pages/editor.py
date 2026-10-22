"""Build mode: the panel that rearranges a space (assets/nooklane/editor.js does the drawing)."""

import reflex as rx

from nooklane.pages.common import INPUT, PRIMARY, SECONDARY, T, error_box
from nooklane.states.space import SpaceState as S

# Floor characters with their swatch colors (FLOOR_COLORS in assets/nooklane/art.js).
FLOORS = [
    (".", "#c99a64"), ("d", "#8d5f3f"), (",", "#5ea79f"), (";", "#c98d8f"), ("b", "#6e8bc5"),
    ("_", "#e9e5dd"), ("-", "#d9d0c1"), (":", "#cdb991"), ('"', "#82c15d"), ("s", "#e8d39c"),
    ("~", "#4ea6d9"), ("=", "#7d5232"), (" ", "#262a33"),
]
WALLS = [("#", "brick-wall"), ("w", "app-window"), ("f", "fence"), ("h", "trees")]
OBJECTS = [
    "desk", "office_chair", "chair", "armchair", "sofa", "table_round", "table_long", "coffee_table",
    "cafe_table", "umbrella", "bookshelf", "counter", "fridge", "coffee_machine", "water_cooler",
    "vending", "printer", "lamp", "plant", "big_plant", "rug", "podium", "piano", "arcade", "trash",
    "painting", "whiteboard", "tv", "note", "portal", "tree", "pine", "bush", "flowers", "bench",
    "fountain", "lamp_post", "campfire", "log", "rock", "picnic_table",
]
TOOLS = [
    ("object", "armchair", "tool_object"),
    ("floor", "paint-bucket", "tool_floor"),
    ("wall", "brick-wall", "tool_wall"),
    ("area", "square-dashed", "tool_area"),
    ("spawn", "map-pin", "tool_spawn"),
    ("erase", "eraser", "tool_erase"),
    ("select", "mouse-pointer-2", "tool_select"),
]
_DEFAULT_OPTION = {"object": "plant", "floor": ".", "wall": "#", "area": "private", "spawn": "", "erase": "", "select": ""}


def _picked(tool: str, option: str) -> rx.Var:
    return (S.ed_tool == tool) & (S.ed_option == option)


def tool_tab(tool: str, icon: str, key: str) -> rx.Component:
    return rx.tooltip(
        rx.el.button(
            rx.icon(icon, class_name="h-4 w-4"),
            on_click=S.set_tool(tool, _DEFAULT_OPTION[tool]),
            custom_attrs={"data-tool": tool},
            class_name=rx.cond(S.ed_tool == tool, "p-2 rounded-lg bg-teal-600 text-white", "p-2 rounded-lg text-gray-600 hover:bg-gray-100"),
        ),
        content=T[key],
    )


def object_palette() -> rx.Component:
    def item(t: str) -> rx.Component:
        return rx.tooltip(
            rx.el.button(
                rx.el.canvas(custom_attrs={"data-nook-object": t}, class_name="w-full h-full", style={"imageRendering": "pixelated"}),
                on_click=S.set_tool("object", t),
                custom_attrs={"data-object": t},
                class_name=rx.cond(_picked("object", t), "aspect-square rounded-lg ring-2 ring-teal-500 bg-teal-50 p-0.5",
                                   "aspect-square rounded-lg ring-1 ring-gray-200 hover:ring-teal-300 bg-[#f3efe6] p-0.5"),
            ),
            content=T[f"obj_{t}"],
        )

    return rx.el.div(*[item(t) for t in OBJECTS], class_name="grid grid-cols-6 gap-1.5")


def floor_palette() -> rx.Component:
    def item(ch: str, color: str) -> rx.Component:
        return rx.el.button(
            rx.el.span(class_name="size-6 rounded-md border border-black/10 shrink-0", style={"background": color}),
            rx.el.span(T[f"floor_{ch}"], class_name="text-xs font-semibold text-gray-700 truncate"),
            on_click=S.set_tool("floor", ch),
            class_name=rx.cond(_picked("floor", ch), "flex items-center gap-2 p-1.5 rounded-lg ring-2 ring-teal-500 bg-teal-50",
                               "flex items-center gap-2 p-1.5 rounded-lg ring-1 ring-gray-200 hover:ring-teal-300"),
        )

    return rx.el.div(*[item(ch, color) for ch, color in FLOORS], class_name="grid grid-cols-2 gap-1.5")


def wall_palette() -> rx.Component:
    def item(ch: str, icon: str) -> rx.Component:
        return rx.el.button(
            rx.icon(icon, class_name="h-4 w-4 text-gray-600"),
            rx.el.span(T[f"wall_{ch}"], class_name="text-xs font-semibold text-gray-700"),
            on_click=S.set_tool("wall", ch),
            class_name=rx.cond(_picked("wall", ch), "flex items-center gap-2 p-2 rounded-lg ring-2 ring-teal-500 bg-teal-50",
                               "flex items-center gap-2 p-2 rounded-lg ring-1 ring-gray-200 hover:ring-teal-300"),
        )

    return rx.el.div(*[item(ch, icon) for ch, icon in WALLS], class_name="grid grid-cols-2 gap-1.5")


def area_palette() -> rx.Component:
    def item(kind: str, icon: str, key: str) -> rx.Component:
        return rx.el.button(
            rx.icon(icon, class_name="h-4 w-4"),
            rx.el.span(T[key], class_name="text-xs font-bold"),
            on_click=S.set_tool("area", kind),
            custom_attrs={"data-area-kind": kind},
            class_name=rx.cond(_picked("area", kind), "flex items-center gap-2 p-2 rounded-lg ring-2 ring-teal-500 bg-teal-50 text-gray-800",
                               "flex items-center gap-2 p-2 rounded-lg ring-1 ring-gray-200 hover:ring-teal-300 text-gray-700"),
        )

    return rx.el.div(
        rx.el.div(item("private", "lock", "area_private"), item("spotlight", "star", "area_spotlight"), class_name="grid grid-cols-1 gap-1.5"),
        rx.el.p(T["pick_area_hint"], class_name="text-xs text-gray-500 mt-2"),
    )


def hint(key: str) -> rx.Component:
    return rx.el.p(T[key], class_name="text-xs text-gray-500")


def selection_box() -> rx.Component:
    small = "inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1.5 rounded-lg"
    return rx.cond(
        S.ed_sel_kind != "",
        rx.el.div(
            rx.el.p(T["selected"], ": ", rx.el.span(S.ed_sel_label, class_name="text-gray-900"), class_name="text-xs font-bold text-gray-500"),
            rx.cond(
                S.ed_sel_kind == "area",
                rx.el.div(
                    rx.el.form(
                        rx.el.input(name="area_name", default_value=S.ed_sel_name, key=S.ed_sel_name, placeholder=T["area_name"],
                                    class_name=INPUT + " text-sm py-1.5"),
                        rx.el.button(T["rename"], type="submit", class_name=small + " bg-gray-100 hover:bg-gray-200 text-gray-800"),
                        on_submit=S.editor_rename_area,
                        reset_on_submit=False,
                        class_name="flex gap-1.5",
                    ),
                    rx.el.div(
                        rx.el.button(rx.icon("lock", class_name="h-3.5 w-3.5"), T["area_private"], on_click=S.editor_area_kind("private"),
                                     class_name=rx.cond(S.ed_sel_area_kind == "private", small + " bg-teal-600 text-white", small + " bg-gray-100 text-gray-700")),
                        rx.el.button(rx.icon("star", class_name="h-3.5 w-3.5"), T["area_spotlight"], on_click=S.editor_area_kind("spotlight"),
                                     class_name=rx.cond(S.ed_sel_area_kind == "spotlight", small + " bg-amber-500 text-white", small + " bg-gray-100 text-gray-700")),
                        class_name="flex flex-wrap gap-1.5",
                    ),
                    class_name="flex flex-col gap-1.5",
                ),
                rx.fragment(),
            ),
            rx.el.div(
                rx.cond(S.ed_sel_turns, rx.el.button(rx.icon("rotate-cw", class_name="h-3.5 w-3.5"), T["rotate"], on_click=S.editor_call("rotateSelected"),
                                                    class_name=small + " bg-gray-100 hover:bg-gray-200 text-gray-800"), rx.fragment()),
                rx.cond(S.ed_sel_portal, rx.el.button(rx.icon("crosshair", class_name="h-3.5 w-3.5"), T["set_destination"], on_click=S.editor_call("pickPortalTarget"),
                                                     class_name=small + " bg-violet-100 hover:bg-violet-200 text-violet-900"), rx.fragment()),
                rx.el.button(rx.icon("trash-2", class_name="h-3.5 w-3.5"), T["delete"], on_click=S.editor_call("deleteSelected"),
                             class_name=small + " bg-red-50 hover:bg-red-100 text-red-700"),
                class_name="flex flex-wrap gap-1.5",
            ),
            rx.cond(S.ed_sel_portal, rx.el.p(T["leads_to"], ": ", S.ed_portal_label, class_name="text-xs text-gray-500"), rx.fragment()),
            rx.cond(S.ed_picking, rx.el.p(T["pick_destination"], class_name="text-xs font-bold text-violet-700"), rx.fragment()),
            id="editor-selection",
            class_name="flex flex-col gap-2 bg-amber-50 border border-amber-100 rounded-xl p-2.5",
        ),
        rx.fragment(),
    )


def space_settings() -> rx.Component:
    return rx.el.details(
        rx.el.summary(T["space_settings"], class_name="text-xs font-bold text-gray-600 cursor-pointer"),
        rx.el.div(
            rx.el.form(
                rx.el.input(name="space_name", default_value=S.space_name, key=S.space_name, class_name=INPUT + " text-sm py-1.5"),
                rx.el.button(T["rename"], type="submit", class_name=SECONDARY + " text-xs"),
                on_submit=S.rename_space,
                reset_on_submit=False,
                class_name="flex gap-1.5",
            ),
            rx.cond(
                S.my_build_key != "",
                rx.el.div(
                    rx.el.p(T["build_key_label"], class_name="text-[11px] text-gray-500"),
                    rx.el.div(
                        rx.el.code(S.my_build_key, class_name="text-[11px] bg-gray-100 px-2 py-1 rounded truncate flex-1 min-w-0"),
                        rx.el.button(T["copy"], on_click=S.copy_build_key, class_name="text-xs font-bold text-teal-700"),
                        class_name="flex items-center gap-2",
                    ),
                ),
                rx.fragment(),
            ),
            rx.alert_dialog.root(
                rx.alert_dialog.trigger(
                    rx.el.button(rx.icon("trash-2", class_name="h-3.5 w-3.5"), T["delete_space"],
                                 class_name="inline-flex items-center gap-1 text-xs font-bold text-red-700 hover:underline"),
                ),
                rx.alert_dialog.content(
                    rx.alert_dialog.title(T["delete_space"]),
                    rx.alert_dialog.description(T["delete_confirm"]),
                    rx.el.div(
                        rx.alert_dialog.cancel(rx.el.button(T["cancel"], class_name=SECONDARY)),
                        rx.alert_dialog.action(rx.el.button(T["delete"], on_click=S.delete_space,
                                                            class_name="bg-red-600 hover:bg-red-700 text-white font-bold px-4 py-2 rounded-xl")),
                        class_name="flex justify-end gap-2 mt-4",
                    ),
                ),
            ),
            class_name="flex flex-col gap-2 pt-2",
        ),
        class_name="border-t border-gray-100 pt-2",
    )


def locked_view() -> rx.Component:
    return rx.el.div(
        rx.el.div(rx.icon("lock", class_name="h-5 w-5 text-gray-500 shrink-0"), rx.el.p(T["build_locked"], class_name="text-sm text-gray-600"),
                  class_name="flex items-start gap-2"),
        rx.el.form(
            rx.el.input(name="key", type="password", placeholder=T["build_key"], id="build-key", class_name=INPUT + " text-sm"),
            rx.el.button(T["unlock"], type="submit", class_name=PRIMARY),
            on_submit=S.unlock_build,
            reset_on_submit=True,
            class_name="flex gap-2",
        ),
        rx.cond(S.build_error != "", error_box(S.build_error), rx.fragment()),
        class_name="flex flex-col gap-3",
    )


def build_panel() -> rx.Component:
    return rx.cond(
        S.build_ok,
        rx.el.div(
            rx.el.div(*[tool_tab(*t) for t in TOOLS], class_name="flex flex-wrap gap-1 bg-gray-50 p-1 rounded-xl"),
            rx.el.div(
                rx.match(
                    S.ed_tool,
                    ("object", object_palette()),
                    ("floor", rx.el.div(hint("floor_hint"), floor_palette(), class_name="flex flex-col gap-2")),
                    ("wall", rx.el.div(hint("floor_hint"), wall_palette(), class_name="flex flex-col gap-2")),
                    ("area", area_palette()),
                    ("spawn", hint("spawn_hint")),
                    ("erase", hint("erase_hint")),
                    hint("select_hint"),
                ),
                class_name="flex-1 min-h-0 overflow-y-auto py-2 pr-1",
            ),
            selection_box(),
            rx.el.div(
                rx.el.button(rx.icon("undo-2", class_name="h-4 w-4"), T["undo"], on_click=S.editor_call("undo"),
                             disabled=S.ed_undo == 0, class_name=SECONDARY + " text-sm whitespace-nowrap disabled:opacity-40"),
                rx.el.button(T["discard"], on_click=S.editor_call("discard"), disabled=~S.ed_dirty,
                             class_name=SECONDARY + " text-sm whitespace-nowrap disabled:opacity-40"),
                rx.el.button(
                    rx.cond(S.saving_map, rx.spinner(size="1"), rx.icon("save", class_name="h-4 w-4")),
                    T["save_map"],
                    on_click=S.save_map,
                    disabled=~S.ed_dirty | S.saving_map,
                    id="save-map",
                    class_name=PRIMARY + " text-sm flex-1 whitespace-nowrap",
                ),
                class_name="flex gap-1.5 pt-2",
            ),
            rx.cond(S.ed_dirty, rx.el.p(T["unsaved"], class_name="text-[11px] font-bold text-amber-700"), rx.fragment()),
            space_settings(),
            id="build-panel",
            class_name="flex flex-col gap-2 h-full min-h-0",
        ),
        locked_view(),
    )
