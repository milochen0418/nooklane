"""Two people in a Cozy Office space: the closer, the clearer.

Alice (avatar mode, her camera shows a face) and Bob (full camera picture)
stand at different distances in the open hall. On Alice's side:

- 1 tile: Bob's voice at full volume, his video tile sharp and opaque, his
  microphone and camera subscribed at the high video layer.
- 4 tiles: voice ~33 %, tile ~59 % opaque and blurred, panned to the right.
- 7 tiles: silent, but still subscribed (so he fades in at once).
- 11 tiles: unsubscribed: no audio, no video, no tile.
- Meeting room A (private): Alice inside, Bob outside its door: nothing either
  way; Bob inside, six tiles away: full voice.
- Bob on the town hall stage (spotlight), Alice far away in the lobby: full voice.
- Chat to everyone arrives as unread; a reaction (key 7), a raised hand (H)
  and a wave reach the other.
- Holding G (ghost mode) disconnects Bob from everyone; releasing it reconnects.
"""

import os
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from common import create_space, delete_space, join, launch, new_page, report, shot, teleport, wait_js, wait_person  # noqa: E402


# Bytes of audio / video received from the others, and the server's media ports.
# (Docker Desktop may rewrite the source port of the replies, so the selected
# pair can show a peer-reflexive port; the host candidate is what the server
# advertised: the published port.)
_INBOUND = """async () => {
    const room = window.nooklane.room;
    let audio = 0, video = 0;
    for (const p of room.remoteParticipants.values()) {
        for (const pub of p.trackPublications.values()) {
            const t = pub.track;
            if (!t || !t.receiver) continue;
            (await t.receiver.getStats()).forEach((r) => {
                if (r.type === 'inbound-rtp') { if (r.kind === 'audio') audio += r.bytesReceived || 0; else video += r.bytesReceived || 0; }
            });
        }
    }
    const ports = [];
    const mgr = room.engine.pcManager;
    for (const tr of [mgr.publisher, mgr.subscriber]) {
        const pc = tr && tr.pc;
        if (!pc) continue;
        // The server's own (host) candidates: where it asked us to send media.
        (await pc.getStats()).forEach((s) => {
            if (s.type === 'remote-candidate' && s.candidateType === 'host') ports.push(s.protocol + ':' + s.port);
        });
    }
    return {audio, video, ports};
}"""


def main() -> int:
    errors: list[str] = []
    with sync_playwright() as pw:
        b1 = launch(pw, with_face=True)
        b2 = launch(pw, with_face=False)
        alice = new_page(b1, errors, "alice")
        bob = new_page(b2, errors, "bob")
        try:
            path = create_space(alice, "office", "Proximity test")
            join(alice, path, "Alice", "avatar")
            join(bob, path, "Bob", "full")
            wait_js(alice, "() => [...window.nooklane.people.values()].some(p => p.x != null)", "alice sees bob")
            wait_js(bob, "() => [...window.nooklane.people.values()].some(p => p.x != null)", "bob sees alice")

            teleport(alice, 19, 12)
            teleport(bob, 20, 12)
            p = wait_person(alice, "Bob", "p.link.gain > 0.99 && p.volume > 0.99 && p.subs.microphone && p.subs.camera "
                                          "&& p.link.quality === 2 && p.tile && p.tile.video && p.tile.opacity === '1' && p.tile.filter === 'none'", "1 tile")
            print("1 tile:", p["link"], p["tile"])
            wait_person(bob, "Alice", "p.link.gain > 0.99 && p.face.packets > 3 && p.face.found && !p.subs.camera && p.tile && !p.tile.video",
                        "bob sees alice's avatar")
            first = alice.evaluate(_INBOUND)
            alice.wait_for_timeout(2000)
            second = alice.evaluate(_INBOUND)
            assert second["audio"] > first["audio"] > 0, f"no audio arriving: {first} -> {second}"
            assert second["video"] > first["video"], f"no video arriving: {first} -> {second}"
            print(f"media: audio {first['audio']} -> {second['audio']} bytes, video {first['video']} -> {second['video']}, ports {second['ports']}")
            expect = os.environ.get("EXPECT_MEDIA_PORT", "")
            if expect:
                assert any(p.endswith(":" + expect) for p in second["ports"]), f"media not on port {expect}: {second['ports']}"
            shot(alice, "alice_1_tile")
            shot(bob, "bob_1_tile")

            teleport(bob, 23, 12)
            p = wait_person(alice, "Bob", "Math.abs(p.link.d - 4) < 0.05 && p.link.gain > 0.25 && p.link.gain < 0.45 "
                                          "&& p.link.opacity > 0.5 && p.link.opacity < 0.7 && p.link.blur > 1.5 && p.link.pan > 0.5 "
                                          "&& Math.abs(p.volume - p.link.gain) < 0.01", "4 tiles")
            print("4 tiles:", p["link"], p["tile"])
            shot(alice, "alice_4_tiles")

            teleport(bob, 26, 12)
            p = wait_person(alice, "Bob", "p.link.d > 6.9 && p.link.gain === 0 && p.volume === 0 && p.subs.microphone === true", "7 tiles")
            print("7 tiles:", p["link"], p["subs"])

            teleport(bob, 30, 12)
            p = wait_person(alice, "Bob", "p.link.d > 9 && p.subs.microphone === false && p.subs.camera === false && !p.tile", "11 tiles")
            print("11 tiles:", p["link"], p["subs"])
            shot(alice, "alice_11_tiles")

            teleport(alice, 20, 6)
            teleport(bob, 20, 9)
            wait_person(alice, "Bob", "p.link.kind === 'none' && !p.subs.microphone", "private room, Bob outside")
            wait_person(bob, "Alice", "p.link.kind === 'none' && !p.subs.microphone", "private room, seen from outside")
            teleport(bob, 24, 2)
            p = wait_person(alice, "Bob", "p.link.kind === 'area' && p.link.gain === 1 && p.link.d > 5 && p.subs.microphone", "private room, Bob inside")
            print("meeting room:", p["link"])
            wait_js(alice, "() => document.querySelector('#area-chip')?.innerText.includes('Meeting room A')", "area chip")
            shot(alice, "alice_meeting_room")

            teleport(alice, 21, 26)
            teleport(bob, 33, 17)
            p = wait_person(alice, "Bob", "p.link.kind === 'spotlight' && p.link.gain === 1 && p.link.d > 10 && p.subs.microphone", "stage")
            print("stage:", p["link"])
            shot(alice, "alice_hears_stage")

            bob.click("#chat-button")
            bob.click('button[data-scope="all"]')
            bob.fill("#nook-chat-input", "Hello from the stage")
            bob.press("#nook-chat-input", "Enter")
            wait_js(alice, "() => document.querySelector('#chat-button')?.textContent.includes('1')", "unread chat")
            alice.click("#chat-button")
            wait_js(alice, "() => [...document.querySelectorAll('.chat-msg')].some(m => m.innerText.includes('Hello from the stage'))", "chat shown")
            bob.keyboard.press("Escape")
            bob.evaluate("() => window.nooklane.emote(2)")
            wait_person(alice, "Bob", "p.emote === '🎉'", "reaction")
            bob.locator("canvas.nook-canvas").focus()
            bob.keyboard.press("7")
            wait_person(alice, "Bob", "p.emote === '💯'", "reaction on key 7")
            bob.keyboard.press("h")
            wait_person(alice, "Bob", "p.hand === true", "raised hand")
            alice.evaluate("(id) => window.nooklane.wave(id)", alice.evaluate("() => [...window.nooklane.people.keys()][0]"))
            wait_person(bob, "Alice", "p.emote === '👋'", "wave")
            print("chat, reactions, raised hand and wave arrived")

            teleport(alice, 19, 12)
            teleport(bob, 20, 12)
            wait_person(alice, "Bob", "p.link.gain > 0.99", "side by side again")
            bob.locator("canvas.nook-canvas").focus()
            bob.keyboard.down("g")
            wait_person(alice, "Bob", "p.link.kind === 'none' && !p.subs.microphone", "ghost mode")
            bob.keyboard.up("g")
            wait_person(alice, "Bob", "p.link.gain > 0.99 && p.subs.microphone", "ghost mode released")
            print("ghost mode: disconnected while G is held")
            teleport(alice, 21, 26)
            delete_space(alice)
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
