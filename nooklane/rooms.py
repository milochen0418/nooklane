"""Joining a space's LiveKit room, and how many people are in each room.

Each space is one LiveKit room on the embedded server, named after the space
id. Tokens let a participant publish the microphone, a camera picture (the
close-up or the full picture) and a screen, send data packets (positions,
expressions, chat), and change their own attributes (look, camera mode,
status, raised hand).
"""

from __future__ import annotations

import logging
import os
import re
import secrets

import reflex as rx
from livekit import api

from nooklane import livekit_server

logger = logging.getLogger(__name__)


def public_ws_url() -> str:
    """LiveKit URL for browsers: this app's own backend, which relays /rtc.

    ``api_url`` is ``http://localhost:8000`` locally and is patched to
    ``https://<subdomain>.reflex-ddns.com`` by the re-ddns smart launcher.
    """
    override = os.environ.get("LIVEKIT_PUBLIC_URL", "").strip()
    if override:
        return override.rstrip("/")
    return re.sub(r"^http", "ws", rx.config.get_config().api_url.rstrip("/"))


def mint_token(space_id: str, name: str, attributes: dict[str, str]) -> str:
    key, secret = livekit_server.api_credentials()
    grant = api.VideoGrants(
        room_join=True,
        room=space_id,
        can_publish=True,
        can_subscribe=True,
        can_publish_data=True,
        can_publish_sources=["microphone", "camera", "screen_share", "screen_share_audio"],
        can_update_own_metadata=True,
    )
    base = re.sub(r"[^\w.-]+", "_", name)[:40] or "guest"
    return (
        api.AccessToken(key, secret)
        # Unique identity, so the same person can be in twice (two tabs or devices).
        .with_identity(f"{base}#{secrets.token_hex(3)}")
        .with_name(name)
        .with_attributes({k: str(v) for k, v in attributes.items()})
        .with_grants(grant)
        .to_jwt()
    )


async def occupancy() -> dict[str, int]:
    """Room name -> number of people in it (empty when the server is down)."""
    if not livekit_server.healthy():
        return {}
    key, secret = livekit_server.api_credentials()
    lk = api.LiveKitAPI(f"http://127.0.0.1:{livekit_server.SIGNAL_PORT}", key, secret)
    try:
        rooms = await lk.room.list_rooms(api.ListRoomsRequest())
        return {r.name: int(r.num_participants) for r in rooms.rooms}
    except Exception as exc:  # noqa: BLE001 - only a nicety for the lobby
        logger.info("Could not list rooms: %s", exc)
        return {}
    finally:
        await lk.aclose()
