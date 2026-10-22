"""The front page, the embedded LiveKit server and the pre-join screen.

- The front page lists the spaces (the starter "Nooklane HQ" at least) and the
  six templates, and draws their map thumbnails.
- The LiveKit server reports running; /rtc is relayed to it; map JSON and the
  vendored scripts (LiveKit client, MediaPipe) are served.
- A space's pre-join screen shows the map behind it, the four camera modes and
  the character; the language switch changes the words.
"""

import sys
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from common import BACKEND_URL, BASE_URL, launch, new_page, open_space, report, shot, wait_js  # noqa: E402


def fetch(path: str, base: str = BASE_URL) -> tuple[int, bytes]:
    import ssl
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    try:
        with urllib.request.urlopen(base + path, timeout=20, context=ctx) as r:  # noqa: S310
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, b""


def main() -> int:
    errors: list[str] = []
    with sync_playwright() as pw:
        browser = launch(pw, with_face=False)
        page = new_page(browser, errors, "visitor")
        page.goto(BASE_URL + "/", wait_until="domcontentloaded")
        page.wait_for_selector(".space-card", timeout=90000)
        page.wait_for_selector('#server-status[data-phase="running"]', timeout=120000)
        cards = page.locator(".template-card").count()
        assert cards == 6, f"expected 6 templates, got {cards}"
        assert page.locator('.space-card[data-space="nooklane-hq"]').count() == 1, "starter space missing"
        wait_js(page, "() => [...document.querySelectorAll('canvas[data-nook-thumb]')].filter(c => c.dataset.nookDrawn).length >= 7",
                "thumbnails drawn", 30000)
        shot(page, "front_page")
        print("front page: 6 templates, starter space, thumbnails drawn")

        # Backend routes and vendored files.
        status, body = fetch("/_nooklane/template/office", BACKEND_URL)
        assert status == 200 and b'"spawns"' in body, f"template JSON: {status}"
        status, _ = fetch("/_nooklane/map/nooklane-hq", BACKEND_URL)
        assert status == 200, f"space map JSON: {status}"
        status, _ = fetch("/_nooklane/map/does-not-exist", BACKEND_URL)
        assert status == 404, f"unknown space: {status}"
        # livekit-server answers its validate endpoint (401 without a token) through the relay.
        status, _ = fetch("/rtc/validate", BACKEND_URL)
        assert status in (200, 401), f"/rtc relay: {status}"
        for path in ("/livekit-client.umd.js", "/mediapipe/vision_wasm_internal.wasm", "/mediapipe/face_landmarker.task",
                     "/nooklane/client.js", "/nooklane/world.js", "/nooklane/art.js"):
            status, _ = fetch(path)
            assert status == 200, f"{path}: {status}"
        print("routes: map JSON, /rtc relay, scripts and MediaPipe served")

        # Pre-join screen, in both languages.
        open_space(page, "/s/nooklane-hq")
        for mode in ("avatar", "face", "full", "off"):
            assert page.locator(f'button[data-mode="{mode}"]').count() == 1, f"mode button {mode}"
        wait_js(page, "() => document.querySelector('canvas[data-nook-sprite]')?.dataset.nookDrawn", "character drawn")
        before = page.inner_text("#join-button")
        page.click("#lang-toggle")
        wait_js(page, f"() => document.querySelector('#join-button').innerText.trim() !== {before.strip()!r}", "language switch")
        after = page.inner_text("#join-button")
        print(f"pre-join: join button {before.strip()!r} -> {after.strip()!r}")
        shot(page, "prejoin")
        page.click("#lang-toggle")
        browser.close()
    report(errors)
    if errors:
        print("FAIL: page errors")
        return 1
    print("PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
