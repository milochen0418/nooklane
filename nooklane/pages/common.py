import reflex as rx

from nooklane.states.lang import LangState
from nooklane.states.server_state import ServerStatusState

T = LangState.t

FONT = "font-['Nunito',system-ui,sans-serif]"
PRIMARY = (
    "inline-flex items-center justify-center gap-2 bg-teal-600 hover:bg-teal-700 text-white font-bold "
    "px-4 py-2.5 rounded-xl transition-colors disabled:opacity-60 shadow-sm"
)
SECONDARY = (
    "inline-flex items-center justify-center gap-2 bg-white hover:bg-gray-50 text-gray-800 font-semibold "
    "px-3.5 py-2 rounded-xl border border-gray-200 transition-colors"
)
INPUT = (
    "w-full px-3.5 py-2.5 border border-gray-200 rounded-xl bg-white focus:ring-2 focus:ring-teal-500 "
    "focus:border-transparent outline-none transition-all"
)


def logo(size: str = "h-9 w-9") -> rx.Component:
    return rx.el.div(
        rx.icon("door-open", class_name="h-5 w-5 text-white"),
        class_name=f"{size} rounded-xl bg-teal-600 flex items-center justify-center shadow-sm shrink-0",
    )


def lang_toggle(dark: bool = False) -> rx.Component:
    cls = (
        "text-xs font-bold px-2.5 py-1.5 rounded-lg transition-colors "
        + ("bg-white/10 hover:bg-white/20 text-white" if dark else "bg-white hover:bg-gray-50 text-gray-700 border border-gray-200")
    )
    return rx.el.button(
        rx.icon("languages", class_name="h-3.5 w-3.5 inline mr-1"),
        T["lang_other"],
        on_click=LangState.toggle_lang,
        id="lang-toggle",
        class_name=cls,
    )


def server_pill() -> rx.Component:
    return rx.el.div(
        rx.el.div(
            class_name=rx.match(
                ServerStatusState.phase,
                ("running", "size-2 rounded-full bg-green-500"),
                ("error", "size-2 rounded-full bg-red-500"),
                "size-2 rounded-full bg-yellow-500 animate-pulse",
            )
        ),
        rx.match(
            ServerStatusState.phase,
            ("running", rx.el.span(T["server_running"], " ", ServerStatusState.version)),
            ("downloading", rx.el.span(T["server_downloading"])),
            ("error", rx.el.span(T["server_error"])),
            rx.el.span(T["server_starting"]),
        ),
        id="server-status",
        data_phase=ServerStatusState.phase,
        class_name="flex items-center gap-2 bg-white px-3 py-1 rounded-full border border-gray-200 text-xs font-semibold text-gray-600",
    )


def error_box(message: rx.Var) -> rx.Component:
    return rx.el.div(
        rx.icon("circle-alert", class_name="h-5 w-5 text-red-500 shrink-0"),
        rx.el.p(message, class_name="text-red-700 text-sm break-words min-w-0"),
        class_name="bg-red-50 p-3 rounded-xl flex items-center gap-3 border border-red-100",
    )


def sprite(look: rx.Var | str, cls: str, walk: bool = False) -> rx.Component:
    """A character drawn by assets/nooklane/previews.js."""
    attrs = {"data-nook-sprite": look}
    if walk:
        attrs["data-nook-walk"] = "1"
    return rx.el.canvas(custom_attrs=attrs, class_name=cls, style={"imageRendering": "pixelated"})
