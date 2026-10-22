import asyncio
import os
import re

import reflex as rx

from nooklane import livekit_server
from nooklane.rooms import public_ws_url


class SettingsState(rx.State):
    """Admin view of the built-in LiveKit server (gated by ADMIN_PASSCODE)."""

    is_admin_authenticated: bool = False
    is_authenticating: bool = False
    auth_error: str = ""

    server: dict[str, str] = {}
    livekit_url: str = ""
    server_api_url: str = ""
    livekit_api_key: str = ""
    livekit_api_secret: str = ""
    node_ip_override: str = ""
    server_log: str = ""
    is_saving: bool = False
    is_restarting: bool = False

    @rx.event
    def on_settings_load(self):
        """Reset admin gate when navigating to /settings."""
        self.is_admin_authenticated = False
        self.is_authenticating = False
        self.auth_error = ""
        # Don't load secrets until admin is authenticated.
        self.livekit_api_key = ""
        self.livekit_api_secret = ""
        self.server_log = ""

    @rx.event
    async def verify_admin(self, form_data: dict):
        self.is_authenticating = True
        self.auth_error = ""
        yield
        try:
            provided = (form_data.get("admin_passcode") or "").strip()
            expected = (os.environ.get("ADMIN_PASSCODE") or "").strip()

            if not expected:
                self.auth_error = "ADMIN_PASSCODE is not set in the environment."
                yield rx.toast.error(self.auth_error)
                return

            if provided != expected:
                self.auth_error = "Invalid admin passcode."
                yield rx.toast.error(self.auth_error)
                return

            self.is_admin_authenticated = True
            await self._load()
            yield rx.toast.success("Admin access granted.")
        finally:
            self.is_authenticating = False

    async def _load(self) -> None:
        self.server = await asyncio.to_thread(livekit_server.status)
        self.livekit_url = public_ws_url()
        self.server_api_url = re.sub(r"^ws", "http", self.livekit_url)
        self.livekit_api_key, self.livekit_api_secret = livekit_server.api_credentials()
        self.node_ip_override = str(livekit_server.load_settings().get("node_ip", ""))
        self.server_log = await asyncio.to_thread(livekit_server.log_tail)

    @rx.event
    async def refresh(self):
        if self.is_admin_authenticated:
            await self._load()

    @rx.event
    async def save_node_ip(self, form_data: dict):
        """Store the media IP override; the supervisor restarts the server with it."""
        if not self.is_admin_authenticated:
            yield rx.toast.error("Admin access required.")
            return
        value = (form_data.get("node_ip") or "").strip()
        if value and not livekit_server.valid_ip(value):
            yield rx.toast.error(f"Not an IP address: {value}")
            return
        self.is_saving = True
        yield
        try:
            livekit_server.save_settings(node_ip=value)
            await asyncio.to_thread(livekit_server.ensure_running)
            await self._load()
            yield rx.toast.success("Saved. The LiveKit server now advertises "
                                   f"{self.server.get('node_ip', 'auto')}.")
        finally:
            self.is_saving = False

    @rx.event
    async def restart_server(self):
        if not self.is_admin_authenticated:
            yield rx.toast.error("Admin access required.")
            return
        self.is_restarting = True
        yield
        try:
            ok = await asyncio.to_thread(livekit_server.restart)
            await self._load()
            if ok:
                yield rx.toast.success("LiveKit server restarted.")
            else:
                yield rx.toast.error(f"Restart failed: {self.server.get('message', '')}")
        finally:
            self.is_restarting = False
