"""Serve prerendered pages at their own URL in prod (Reflex >= 0.10).

Reflex 0.10's prod server hands pages to Starlette's StaticFiles, which answers
`/intent/call-join` with a redirect to `/intent/call-join/`. Behind the
re-ddns nginx that redirect points at http:// (the app only sees nginx's plain
HTTP), which browsers block inside the https page of a DDNS Intent dialog; and
the trailing slash keeps the intent page from recognizing its own route.
Reflex 0.8 served these pages directly, and so does this.
"""

from urllib.parse import urlsplit


def serve_pages_without_slash_redirect(app):
    """API transformer: follow StaticFiles' trailing-slash redirect on the server."""

    async def wrapped(scope, receive, send):
        path = scope.get("path", "")
        if scope["type"] != "http" or scope["method"] not in ("GET", "HEAD") or path.endswith("/"):
            return await app(scope, receive, send)

        slash_redirect = False

        async def send_unless_slash_redirect(message):
            nonlocal slash_redirect
            if message["type"] == "http.response.start" and message["status"] in (307, 308):
                location = dict(message.get("headers", [])).get(b"location", b"").decode("latin-1")
                slash_redirect = urlsplit(location).path == path + "/"
            if not slash_redirect:
                await send(message)

        await app(scope, receive, send_unless_slash_redirect)
        if slash_redirect:
            page_scope = {**scope, "path": path + "/"}
            if scope.get("raw_path"):
                page_scope["raw_path"] = scope["raw_path"] + b"/"
            await app(page_scope, receive, send)

    return wrapped
