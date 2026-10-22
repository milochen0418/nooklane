"""Map JSON for the lobby's thumbnails (``/_nooklane/...`` on the backend).

    GET /_nooklane/template/<id>     a template's map
    GET /_nooklane/map/<space id>    a space's current map (?v=<version> busts caches)

re-ddns nginx sends ``/_nooklane/`` to the backend (``backend-paths.txt``).
"""

from __future__ import annotations

from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from nooklane import spaces
from nooklane.maps import TEMPLATES, build

_template_cache: dict[str, dict] = {}


async def _template(request: Request) -> Response:
    tid = request.path_params["tid"]
    if tid not in TEMPLATES:
        return JSONResponse({"error": "unknown template"}, status_code=404)
    if tid not in _template_cache:
        _template_cache[tid] = build(tid)
    return JSONResponse(_template_cache[tid], headers={"Cache-Control": "public, max-age=3600"})


async def _map(request: Request) -> Response:
    space = spaces.get_space(request.path_params["sid"])
    if not space:
        return JSONResponse({"error": "unknown space"}, status_code=404)
    return JSONResponse(space["map"], headers={"Cache-Control": "public, max-age=300"})


def register_api_routes(app) -> None:  # noqa: ANN001 - Reflex App
    routes = [
        Route("/_nooklane/template/{tid}", _template, methods=["GET"]),
        Route("/_nooklane/map/{sid}", _map, methods=["GET"]),
    ]
    existing = {getattr(r, "path", None) for r in app._api.routes}
    for route in routes:
        if route.path not in existing:
            app._api.routes.append(route)
