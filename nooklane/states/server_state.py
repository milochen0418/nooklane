import asyncio

import reflex as rx

from nooklane import livekit_server


class ServerStatusState(rx.State):
    """Public (non-secret) status of the built-in LiveKit server."""

    phase: str = "starting"
    message: str = ""
    version: str = ""
    node_ip: str = ""
    node_ip_source: str = ""
    tcp_port: str = ""
    udp_port: str = ""

    @rx.var
    def is_ready(self) -> bool:
        return self.phase == "running"

    def _apply(self, info: dict[str, str]) -> None:
        self.phase = info["phase"]
        self.message = info["message"]
        self.version = info["version"]
        self.node_ip = info["node_ip"]
        self.node_ip_source = info["node_ip_source"]
        self.tcp_port = info["tcp_port"]
        self.udp_port = info["udp_port"]

    @rx.event(background=True)
    async def watch(self):
        """Poll until the server is up (first start may download the binary)."""
        for _ in range(90):
            info = await asyncio.to_thread(livekit_server.status)
            async with self:
                self._apply(info)
            if info["phase"] in ("running", "error"):
                return
            await asyncio.sleep(2)
