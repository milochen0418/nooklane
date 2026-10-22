"""Helpers shared by the Playwright suites (imported by each run_test.py).

Browsers get Chromium's fake camera and microphone. The camera of `with_face`
browsers shows a real face (fixtures/face.mjpeg), so MediaPipe tracks it;
the others show Chromium's test pattern.
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path

from playwright.sync_api import Browser, Page, Playwright

BASE_URL = os.environ.get("BASE_URL", "http://127.0.0.1:3000").rstrip("/")
# The Reflex backend: the same origin behind re-ddns, another port in a local run.
BACKEND_URL = os.environ.get("BACKEND_URL", BASE_URL).rstrip("/")
OUTPUT_DIR = Path(os.environ.get("OUTPUT_DIR", Path(__file__).resolve().parent / "output"))
HEADLESS = os.environ.get("HEADLESS", "1").strip().lower() not in {"0", "false", "no", "off"}
SLOWMO = int(os.environ.get("PW_SLOWMO_MS", "0") or 0)
TIMEOUT = int(os.environ.get("PW_TIMEOUT_MS", "30000") or 30000)
FACE_VIDEO = Path(__file__).resolve().parent / "fixtures" / "face.mjpeg"


def launch(pw: Playwright, *, with_face: bool) -> Browser:
    args = [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        "--autoplay-policy=no-user-gesture-required",
        # Screen sharing without the picker.
        "--auto-select-desktop-capture-source=Entire screen",
        "--enable-usermedia-screen-capturing",
    ]
    if with_face:
        args.append(f"--use-file-for-fake-video-capture={FACE_VIDEO}")
    if BASE_URL.startswith("https://") and ".reflex-ddns.com" in BASE_URL:
        # A Mac may resolve *.reflex-ddns.com to the Docker-internal IP.
        args.append("--host-resolver-rules=MAP *.reflex-ddns.com 127.0.0.1")
    return pw.chromium.launch(headless=HEADLESS, slow_mo=SLOWMO, args=args)


def new_page(browser: Browser, errors: list[str], who: str, *, locale: str = "en-US") -> Page:
    ctx = browser.new_context(viewport={"width": 1280, "height": 820}, locale=locale, ignore_https_errors=True)
    ctx.grant_permissions(["camera", "microphone"])
    page = ctx.new_page()
    page.set_default_timeout(TIMEOUT)

    def on_console(msg):  # noqa: ANN001
        # MediaPipe logs its CPU delegate as an "error".
        if msg.type == "error" and "XNNPACK" not in msg.text and "Outdated Optimize Dep" not in msg.text:
            errors.append(f"[{who}] console: {msg.text}")

    page.on("console", on_console)
    page.on("pageerror", lambda e: errors.append(f"[{who}] pageerror: {e}"))
    return page


def shot(page: Page, name: str) -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(OUTPUT_DIR / f"{name}.png"))


def wait_js(page: Page, js: str, label: str, timeout: int = 20000) -> None:
    try:
        page.wait_for_function(js, timeout=timeout)
    except Exception as exc:  # noqa: BLE001 - say what we waited for
        raise AssertionError(f"{label}: timed out waiting for {js}") from exc


def open_space(page: Page, path: str) -> None:
    page.goto(BASE_URL + path, wait_until="domcontentloaded")
    page.wait_for_selector("#join-name", timeout=90000)
    wait_js(page, "() => window.nooklane && window.nooklane.world && window.nooklane.world.map", "map loaded", 60000)


def join(page: Page, path: str, name: str, mode: str) -> None:
    """Open a space, pick the camera mode, type the name and join."""
    open_space(page, path)
    page.click(f'button[data-mode="{mode}"]')
    page.fill("#join-name", name)
    page.click("#join-button")
    wait_js(page, "() => window.nooklane.connected && window.nooklane.me", f"{name} connected", 30000)


def person(page: Page, name: str) -> dict | None:
    """What this browser knows about `name`: position, link, subscriptions, tile."""
    return page.evaluate(
        "(n) => window.nooklane.debug().people.find((p) => p.name === n) || null", name
    )


def wait_person(page: Page, name: str, predicate_js: str, label: str, timeout: float = 20.0) -> dict:
    """Wait until `predicate_js` (an expression over `p`) holds for `name`."""
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        last = person(page, name)
        if last is not None and page.evaluate(
            f"(p) => {{ try {{ return !!({predicate_js}); }} catch (e) {{ return false; }} }}", last
        ):
            return last
        time.sleep(0.25)
    raise AssertionError(f"{label}: {predicate_js} never held; last = {json.dumps(last)}")


def teleport(page: Page, x: int, y: int) -> None:
    page.evaluate("([x, y]) => window.nooklane.teleport(x, y)", [x, y])


def tile_point(page: Page, x: int, y: int) -> tuple[float, float]:
    """Screen point of the middle of tile (x, y) once the camera has settled."""
    page.wait_for_timeout(600)
    return tuple(page.evaluate(
        """([x, y]) => {
            const w = window.nooklane.world;
            const r = w.canvas.getBoundingClientRect();
            return [r.left + r.width / 2 + ((x * 16 + 8) - w.cam.x) * w.zoom,
                    r.top + r.height / 2 + ((y * 16 + 8) - w.cam.y) * w.zoom];
        }""",
        [x, y],
    ))


def report(errors: list[str]) -> None:
    for line in errors[:40]:
        print(line)


def create_space(page: Page, template: str, name: str) -> str:
    """Make a space from a template on the front page; returns its path (/s/<id>)."""
    page.goto(BASE_URL + "/", wait_until="domcontentloaded")
    page.click(f'button[data-template="{template}"]', timeout=90000)
    page.fill("#create-name", name)
    page.click("#create-submit")
    page.wait_for_url("**/s/*", timeout=20000)
    return "/s/" + page.url.rstrip("/").rsplit("/s/", 1)[1]


def delete_space(page: Page) -> None:
    """Delete the space this (joined, owning) page is in, through Build → Space settings."""
    if not page.locator("#build-panel").count():
        page.click("#build-button")
        page.wait_for_selector("#build-panel", timeout=10000)
    page.locator("#build-panel summary").click()
    page.locator("#build-panel").get_by_role("button", name="Delete space").click()
    page.get_by_role("alertdialog").get_by_role("button", name="Delete", exact=True).click()
    page.wait_for_url(BASE_URL + "/", timeout=20000)
