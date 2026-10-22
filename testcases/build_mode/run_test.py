"""Build mode: only the owner rearranges a space; everyone sees the result.

- A guest's Build panel is locked, and a wrong key does not open it.
- The owner (who made the space on the front page, so this browser has its
  key) draws a private nook, places a sofa and a whiteboard, and saves.
- The guest gets the new layout at once, and the new nook is private.
- The guest writes on the whiteboard (X next to it); the owner sees the text.
- The owner deletes the space.
"""

import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from common import create_space, delete_space, join, launch, new_page, report, shot, teleport, tile_point, wait_js, wait_person  # noqa: E402


def main() -> int:
    errors: list[str] = []
    with sync_playwright() as pw:
        b1 = launch(pw, with_face=False)
        b2 = launch(pw, with_face=False)
        owner = new_page(b1, errors, "owner")
        guest = new_page(b2, errors, "guest")
        try:
            path = create_space(owner, "blank", "Build test")
            join(owner, path, "Owner", "off")
            join(guest, path, "Guest", "off")
            teleport(owner, 4, 4)
            teleport(guest, 16, 12)

            guest.click("#build-button")
            guest.wait_for_selector("#build-key")
            guest.fill("#build-key", "not-the-key")
            guest.press("#build-key", "Enter")
            wait_js(guest, "() => document.querySelector('#side-panel')?.innerText.includes('does not unlock')", "wrong key refused")
            assert guest.locator("#build-panel").count() == 0, "guest must not get the build panel"
            guest.click("#build-button")
            print("guest: build mode locked, wrong key refused")

            owner.click("#build-button")
            owner.wait_for_selector("#build-panel")
            owner.click('button[data-tool="area"]')
            a = tile_point(owner, 2, 2)
            b = tile_point(owner, 6, 5)
            owner.mouse.move(*a)
            owner.mouse.down()
            owner.mouse.move(*b, steps=6)
            owner.mouse.up()
            wait_js(owner, "() => window.nookEditor.draft.areas.length === 1 && window.nookEditor.draft.areas[0].kind === 'private'", "nook drawn")
            owner.click('button[data-tool="object"]')
            owner.click('button[data-object="sofa"]')
            owner.mouse.click(*tile_point(owner, 3, 3))
            owner.click('button[data-object="whiteboard"]')
            owner.mouse.click(*tile_point(owner, 12, 3))
            wait_js(owner, "() => window.nookEditor.draft.objects.some(o => o.t === 'sofa') && window.nookEditor.draft.objects.some(o => o.t === 'whiteboard')",
                    "things placed")
            shot(owner, "owner_building")
            owner.click("#save-map")
            wait_js(owner, "() => !window.nookEditor.dirty", "saved")
            owner.click("#build-button")
            wait_js(guest, "() => window.nooklane.world.areas.length === 1 && window.nooklane.world.objects.some(o => o.t === 'whiteboard')",
                    "guest got the new layout")
            print("owner built and saved; guest got the layout")

            teleport(owner, 3, 4)
            teleport(guest, 8, 4)
            wait_person(guest, "Owner", "p.link.kind === 'none'", "the new nook is private")
            print("new nook is private")

            board = owner.evaluate("() => window.nooklane.world.objects.find(o => o.t === 'whiteboard')")
            teleport(guest, board["x"], board["y"] + 1)
            guest.wait_for_timeout(400)
            guest.locator("canvas.nook-canvas").focus()
            guest.keyboard.press("ArrowUp")
            guest.keyboard.press("x")
            guest.wait_for_selector("#dialog-text", timeout=10000)
            guest.fill("#dialog-text", "Ideas from the guest")
            guest.click("#dialog-save")
            wait_js(owner, "() => window.nooklane.world.objects.some(o => o.t === 'whiteboard' && o.text === 'Ideas from the guest')",
                    "owner sees the board text")
            print("guest wrote on the whiteboard; owner sees it")
            shot(guest, "guest_board")
            guest.keyboard.press("Escape")
            delete_space(owner)
            print("space deleted")
        finally:
            b1.close()
            b2.close()
    report(errors)
    if errors:
        print("FAIL: page errors")
        return 1
    print("PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
