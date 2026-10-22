"""What others see of you, in each camera mode (Blank Room space).

The owner switches modes while a guest stands next to them:

- avatar: no video track; expression packets arrive with a found face, and an
  injected laugh reads as "laughing" on the guest's side.
- face (real face, close up): a square video (360 x 360) is published.
- full: the 640 x 480 camera picture (the guest asks for the high layer);
  the guest's meeting view shows it as a big tile, and Escape goes back.
- off: no video; the guest's tile shows the character, the camera is unsubscribed.
- screen sharing: the guest next to the owner gets a screen tile (1920 x 1080),
  which goes away when the guest walks off.
"""

import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from common import create_space, delete_space, join, launch, new_page, report, shot, teleport, wait_js, wait_person  # noqa: E402


def switch(page, mode: str) -> None:  # noqa: ANN001
    page.click("#mode-menu")
    page.click(f'[data-mode-item="{mode}"]')


def main() -> int:
    errors: list[str] = []
    with sync_playwright() as pw:
        b1 = launch(pw, with_face=True)
        b2 = launch(pw, with_face=False)
        owner = new_page(b1, errors, "owner")
        guest = new_page(b2, errors, "guest")
        try:
            path = create_space(owner, "blank", "Camera test")
            join(owner, path, "Owner", "avatar")
            join(guest, path, "Guest", "off")
            wait_js(guest, "() => [...window.nooklane.people.values()].some(p => p.x != null)", "guest sees owner")
            teleport(owner, 10, 8)
            teleport(guest, 11, 8)

            p = wait_person(guest, "Owner", "p.mode === 'avatar' && p.face.packets > 3 && p.face.found && !p.subs.camera && p.tile && !p.tile.video", "avatar")
            owner.evaluate("() => window.nooklane.injectFace({mouthSmileLeft: 0.9, mouthSmileRight: 0.9, jawOpen: 0.6}, 4000)")
            p = wait_person(guest, "Owner", "p.face.emotion === 'laughing'", "laugh arrives")
            print("avatar: expression packets only, laugh read as", p["face"]["emotion"])
            shot(guest, "guest_sees_avatar")

            switch(owner, "face")
            p = wait_person(guest, "Owner", "p.mode === 'face' && p.subs.camera && p.tile && p.tile.video && p.tile.width === 360 && p.tile.height === 360",
                            "real face close-up", timeout=30)
            print("face:", p["tile"])
            shot(guest, "guest_sees_face")

            switch(owner, "full")
            p = wait_person(guest, "Owner", "p.mode === 'full' && p.tile && p.tile.video && p.tile.width === 640 && p.tile.height === 480",
                            "full picture", timeout=40)
            print("full:", p["tile"])
            shot(guest, "guest_sees_full")
            guest.click("#meeting-button")
            wait_js(guest, "() => { const t = document.querySelector('.nook-strip.meeting .nook-tile'); return t && t.getBoundingClientRect().width > 400; }",
                    "meeting view")
            shot(guest, "guest_meeting_view")
            guest.keyboard.press("Escape")
            wait_js(guest, "() => !document.querySelector('.nook-strip.meeting')", "back to the map")
            print("meeting view: big tile, Escape back to the map")

            switch(owner, "off")
            p = wait_person(guest, "Owner", "p.mode === 'off' && !p.subs.camera && p.tile && !p.tile.video", "camera off")
            print("off:", p["tile"], p["subs"])
            shot(guest, "guest_sees_off")

            owner.click("#share-button")
            wait_js(guest, "() => { const v = document.querySelector('.nook-tile.screen video'); return v && v.videoWidth === 1920 && v.videoHeight === 1080; }",
                    "screen tile", 30000)
            print("screen share: 1920 x 1080 tile next to the owner")
            shot(guest, "guest_sees_screen")
            teleport(guest, 21, 15)
            wait_js(guest, "() => !document.querySelector('.nook-tile.screen')", "screen tile gone far away")
            owner.click("#share-button")
            print("screen share: gone when the guest walks off")
            delete_space(owner)
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
