"""/settings: the embedded LiveKit server's status and the admin part.

Needs ADMIN_PASSCODE set for the server (the runner passes it on), e.g.
`ADMIN_PASSCODE=test-pass ./run_test_suite.sh settings_admin`.
"""

import os
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from common import BASE_URL, launch, new_page, report, shot  # noqa: E402

PASSCODE = os.environ.get("ADMIN_PASSCODE", "")


def main() -> int:
    if not PASSCODE:
        print("SKIP: set ADMIN_PASSCODE for this suite")
        return 0
    errors: list[str] = []
    with sync_playwright() as pw:
        browser = launch(pw, with_face=False)
        page = new_page(browser, errors, "admin")
        page.goto(BASE_URL + "/settings", wait_until="domcontentloaded")
        page.wait_for_selector('#server-status[data-phase="running"]', timeout=120000) if page.locator("#server-status").count() else None
        page.get_by_placeholder("Enter admin passcode").fill("wrong")
        page.get_by_role("button", name="Unlock Settings").click()
        page.get_by_text("Invalid admin passcode.").first.wait_for()
        page.get_by_placeholder("Enter admin passcode").fill(PASSCODE)
        page.get_by_role("button", name="Unlock Settings").click()
        page.locator("#api-key").wait_for()
        key = page.input_value("#api-key")
        url = page.input_value("#livekit-url")
        assert key.startswith("API") or key, "API key shown"
        assert url.startswith("ws"), f"LiveKit URL: {url}"
        print("admin: key", key[:6] + "…", "url", url)
        shot(page, "settings_admin")
        browser.close()
    report(errors)
    if errors:
        print("FAIL: page errors")
        return 1
    print("PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
