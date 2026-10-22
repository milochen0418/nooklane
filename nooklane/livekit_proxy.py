"""Same-origin relay from the Reflex backend to the embedded livekit-server.

Browsers only talk to ``https://<subdomain>.reflex-ddns.com``: re-ddns nginx
terminates TLS and forwards the paths listed in ``backend-paths.txt`` to the
Reflex backend, and these routes relay them to livekit-server on 127.0.0.1:

    WS   /rtc, /rtc/v1          signalling (the JS SDK appends these to the URL)
    GET  /rtc/.../validate      diagnostics the JS SDK fetches after a failed connect
    ANY  /twirp/...             server API, for other apps' LiveKit server SDKs

Media never passes through here; it goes straight to the published ICE ports.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging

import aiohttp
from starlette.requests import Request
from starlette.responses import Response
from starlette.routing import Route, WebSocketRoute
from starlette.websockets import WebSocket, WebSocketDisconnect

from nooklane import livekit_server

logger = logging.getLogger(__name__)

_HOP_BY_HOP = {
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailers", "transfer-encoding", "upgrade", "host", "content-length",
}


def _upstream_url(scheme: str, path: str, query: str) -> str:
    url = f"{scheme}://127.0.0.1:{livekit_server.SIGNAL_PORT}{path}"
    return f"{url}?{query}" if query else url


def _close_code(code: int | None) -> int:
    # 1005/1006 describe a missing/abnormal close and must not be sent.
    if not code or code in (1005, 1006):
        return 1011
    return code


async def _relay_websocket(websocket: WebSocket) -> None:
    target = _upstream_url("ws", websocket.url.path, websocket.url.query)
    headers = {}
    forwarded = websocket.headers.get("x-forwarded-for") or (
        websocket.client.host if websocket.client else ""
    )
    if forwarded:
        headers["X-Forwarded-For"] = forwarded

    async with aiohttp.ClientSession() as session:
        try:
            upstream = await session.ws_connect(target, headers=headers, max_msg_size=0)
        except aiohttp.ClientError as exc:
            # Refuse the handshake; the SDK then asks /rtc/.../validate for the reason.
            logger.info("LiveKit signal connect refused: %s", exc)
            await websocket.close(code=1011)
            return

        await websocket.accept()

        async def client_to_upstream() -> None:
            while True:
                message = await websocket.receive()
                if message["type"] == "websocket.disconnect":
                    return
                if message.get("bytes") is not None:
                    await upstream.send_bytes(message["bytes"])
                elif message.get("text") is not None:
                    await upstream.send_str(message["text"])

        async def upstream_to_client() -> None:
            async for message in upstream:
                if message.type == aiohttp.WSMsgType.BINARY:
                    await websocket.send_bytes(message.data)
                elif message.type == aiohttp.WSMsgType.TEXT:
                    await websocket.send_text(message.data)
                else:
                    return

        tasks = [
            asyncio.create_task(client_to_upstream()),
            asyncio.create_task(upstream_to_client()),
        ]
        try:
            await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        finally:
            for task in tasks:
                task.cancel()
            for task in tasks:
                with contextlib.suppress(asyncio.CancelledError, WebSocketDisconnect, Exception):
                    await task
            await upstream.close()
            with contextlib.suppress(Exception):
                await websocket.close(code=_close_code(upstream.close_code))


async def _relay_http(request: Request) -> Response:
    target = _upstream_url("http", request.url.path, request.url.query)
    headers = {k: v for k, v in request.headers.items() if k.lower() not in _HOP_BY_HOP}
    body = await request.body()
    try:
        async with aiohttp.ClientSession(auto_decompress=False) as session:
            async with session.request(
                request.method, target, headers=headers, data=body or None,
                allow_redirects=False,
            ) as resp:
                content = await resp.read()
                out_headers = {
                    k: v for k, v in resp.headers.items() if k.lower() not in _HOP_BY_HOP
                }
                return Response(content, status_code=resp.status, headers=out_headers)
    except aiohttp.ClientError as exc:
        return Response(f"LiveKit server unavailable: {exc}", status_code=502)


def register_livekit_routes(app) -> None:  # noqa: ANN001 - Reflex App
    """Register the LiveKit relay routes on the Reflex backend."""
    routes = [
        WebSocketRoute("/rtc", _relay_websocket),
        WebSocketRoute("/rtc/{rest:path}", _relay_websocket),
        Route("/rtc/{rest:path}", _relay_http, methods=["GET"]),
        Route("/twirp/{rest:path}", _relay_http, methods=["GET", "POST"]),
    ]
    existing = {(type(r), getattr(r, "path", None)) for r in app._api.routes}
    for route in routes:
        if (type(route), route.path) not in existing:
            app._api.routes.append(route)
