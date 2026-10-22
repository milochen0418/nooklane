"""/settings: the embedded LiveKit server's status, and its admin part."""

import reflex as rx

from nooklane.pages.common import FONT, T
from nooklane.states.server_state import ServerStatusState
from nooklane.states.settings_state import SettingsState

_CARD = "w-full max-w-md bg-white p-8 rounded-2xl border border-gray-100 shadow-sm"
_PRIMARY_BUTTON = (
    "w-full bg-teal-600 hover:bg-teal-700 text-white font-semibold py-2.5 "
    "rounded-lg transition-colors flex items-center justify-center mt-4 disabled:opacity-50"
)


def input_field(
    label: str, name: str, placeholder: str, type: str = "text", value: str = ""
) -> rx.Component:
    return rx.el.div(
        rx.el.label(label, class_name="block text-sm font-semibold text-gray-700 mb-1"),
        rx.el.input(
            name=name,
            type=type,
            placeholder=placeholder,
            default_value=value,
            key=value,
            class_name="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none transition-all",
        ),
        class_name="w-full",
    )


def error_box(message: rx.Var) -> rx.Component:
    return rx.el.div(
        rx.icon("circle-alert", class_name="h-5 w-5 text-red-500 shrink-0"),
        rx.el.p(message, class_name="text-red-700 text-sm break-words min-w-0"),
        class_name="bg-red-50 p-4 rounded-lg flex items-center gap-3 border border-red-100 mb-2",
    )


def info_row(label: str, value: rx.Var | str) -> rx.Component:
    return rx.el.div(
        rx.el.dt(label, class_name="text-gray-500"),
        rx.el.dd(value, class_name="font-mono text-gray-900 break-all text-right"),
        class_name="flex justify-between gap-4 py-1.5 border-b border-gray-50 text-sm",
    )


def readonly_field(label: str, value: rx.Var, field_id: str) -> rx.Component:
    return rx.el.div(
        rx.el.label(label, class_name="block text-xs font-semibold text-gray-500 mb-1"),
        rx.el.input(
            id=field_id,
            value=value,
            read_only=True,
            class_name="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg font-mono text-xs text-gray-800",
        ),
        class_name="w-full",
    )


def server_admin_panel() -> rx.Component:
    return rx.el.div(
        rx.cond(
            SettingsState.server["message"] != "",
            error_box(SettingsState.server["message"]),
            rx.fragment(),
        ),
        rx.el.h2("Connect other apps", class_name="text-sm font-bold text-gray-900"),
        rx.el.p(
            "Any LiveKit SDK can use this server with these values.",
            class_name="text-xs text-gray-500 mb-2",
        ),
        readonly_field("LiveKit URL (client SDKs)", SettingsState.livekit_url, "livekit-url"),
        readonly_field("Server API URL (server SDKs)", SettingsState.server_api_url, "server-api-url"),
        readonly_field("API Key", SettingsState.livekit_api_key, "api-key"),
        readonly_field("API Secret", SettingsState.livekit_api_secret, "api-secret"),
        rx.el.form(
            rx.el.div(
                input_field(
                    "Media IP override (node_ip)",
                    "node_ip",
                    "empty = " + SettingsState.server["node_ip"],
                    value=SettingsState.node_ip_override,
                ),
                rx.el.p(
                    "The IP browsers send voices, cameras and data packets to (ports TCP ",
                    SettingsState.server["tcp_port"],
                    " / UDP ",
                    SettingsState.server["udp_port"],
                    "). Default: EXTERNAL_IP from re-ddns, i.e. the Docker host's LAN IP.",
                    class_name="text-xs text-gray-500 mt-1",
                ),
                rx.el.button(
                    rx.cond(
                        SettingsState.is_saving,
                        rx.el.span("Saving...", class_name="animate-pulse"),
                        rx.el.div(
                            rx.icon("save", class_name="h-4 w-4"),
                            "Save & Apply",
                            class_name="flex items-center gap-2",
                        ),
                    ),
                    type="submit",
                    disabled=SettingsState.is_saving,
                    class_name=_PRIMARY_BUTTON,
                ),
            ),
            on_submit=SettingsState.save_node_ip,
            reset_on_submit=False,
            class_name="pt-4",
        ),
        rx.el.div(
            rx.el.button(
                rx.icon("rotate-ccw", class_name="h-4 w-4"),
                rx.cond(SettingsState.is_restarting, "Restarting...", "Restart server"),
                on_click=SettingsState.restart_server,
                disabled=SettingsState.is_restarting,
                class_name="flex items-center gap-2 text-sm font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 px-4 py-2 rounded-lg disabled:opacity-50",
            ),
            rx.el.button(
                rx.icon("refresh-cw", class_name="h-4 w-4"),
                "Refresh",
                on_click=SettingsState.refresh,
                class_name="flex items-center gap-2 text-sm font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 px-4 py-2 rounded-lg",
            ),
            class_name="flex gap-3 pt-2",
        ),
        rx.el.div(
            rx.el.p(
                "Server log · pid ",
                SettingsState.server["pid"],
                " · started ",
                SettingsState.server["started_at"],
                class_name="text-xs font-semibold text-gray-500 mb-1",
            ),
            rx.el.pre(
                SettingsState.server_log,
                class_name="text-[10px] leading-4 bg-gray-900 text-gray-100 p-3 rounded-lg max-h-64 overflow-auto whitespace-pre-wrap break-all",
            ),
            class_name="pt-4",
        ),
        class_name="space-y-3",
    )


def settings_page() -> rx.Component:
    return rx.el.div(
        rx.el.div(
            rx.el.div(
                rx.el.a(
                    rx.el.div(
                        rx.icon("arrow-left", class_name="h-4 w-4"),
                        rx.el.span(T["back_lobby"]),
                        class_name="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors",
                    ),
                    href="/",
                    class_name="mb-6 inline-block",
                ),
                rx.el.div(
                    rx.icon("settings", class_name="text-teal-500 h-8 w-8"),
                    rx.el.h1(
                        "LiveKit Server",
                        class_name="text-2xl font-bold text-gray-900",
                    ),
                    class_name="flex items-center gap-3 mb-2",
                ),
                rx.el.p(
                    "Nooklane runs its own open-source LiveKit server inside its "
                    "container. No LiveKit Cloud account or keys are needed.",
                    class_name="text-gray-500 text-sm mb-4",
                ),
                rx.el.dl(
                    info_row("Status", ServerStatusState.phase),
                    info_row("Version", ServerStatusState.version),
                    info_row("Media IP", ServerStatusState.node_ip + " (" + ServerStatusState.node_ip_source + ")"),
                    info_row("Media ports", "TCP " + ServerStatusState.tcp_port + " · UDP " + ServerStatusState.udp_port),
                    class_name="mb-6",
                ),
                rx.cond(
                    SettingsState.is_admin_authenticated,
                    server_admin_panel(),
                    rx.el.form(
                        rx.el.div(
                            rx.cond(
                                SettingsState.auth_error != "",
                                error_box(SettingsState.auth_error),
                                rx.fragment(),
                            ),
                            input_field(
                                "Admin Passcode",
                                "admin_passcode",
                                "Enter admin passcode",
                                type="password",
                            ),
                            rx.el.button(
                                rx.cond(
                                    SettingsState.is_authenticating,
                                    rx.el.span(
                                        "Verifying...", class_name="animate-pulse"
                                    ),
                                    rx.el.div(
                                        rx.icon("lock", class_name="h-4 w-4"),
                                        "Unlock Settings",
                                        class_name="flex items-center gap-2",
                                    ),
                                ),
                                type="submit",
                                disabled=SettingsState.is_authenticating,
                                class_name=_PRIMARY_BUTTON,
                            ),
                            class_name="space-y-5",
                        ),
                        on_submit=SettingsState.verify_admin,
                        reset_on_submit=True,
                    ),
                ),
                class_name=_CARD,
            ),
            class_name="flex flex-col items-center justify-center min-h-screen bg-gray-50 px-4 py-10",
        ),
        class_name=FONT,
    )
