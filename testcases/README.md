# E2E testcases

Playwright end-to-end suites, one per folder:

- `testcases/<suite_name>/run_test.py`
- `testcases/<suite_name>/output/` (screenshots and logs, ignored by git)

Each `run_test.py` exits `0` on success and non-zero on failure, and writes
its screenshots into `OUTPUT_DIR` (provided by the runner). Shared helpers
(launching browsers with a fake camera and microphone, joining a space,
reading `window.nooklane.debug()`) are in `common.py`.

## Suites

| Suite | What it checks |
|-------|----------------|
| `smoke_home` | The front page lists the starter space and the six templates and draws their map thumbnails; the LiveKit server is `running`; map JSON (`/_nooklane/...`), the `/rtc` relay, the vendored LiveKit client and MediaPipe files are served; the pre-join screen shows the four camera modes and the character, and the language switch works. |
| `proximity_av` | Two people in a Cozy Office space. Real audio and video bytes arrive (and with `EXPECT_MEDIA_PORT`, the server advertises that port). At 1 tile: full voice, sharp video, high layer. At 4: ~33 % voice, ~59 % opaque blurred tile, panned. At 7: silent but subscribed. At 11: unsubscribed. A private meeting room isolates both ways and gives full voice inside; a stage (spotlight) is heard from across the map. Chat, reactions (key 7), a raised hand (H) and a wave arrive; holding G (ghost mode) disconnects. |
| `camera_modes` | What a guest sees of the owner in each mode: avatar (expression packets only; an injected laugh reads as laughing), real face close-up (a 360 × 360 video), full picture (640 × 480, and big in meeting view), camera off (character, camera unsubscribed); a shared screen (1920 × 1080) reaches the guest nearby and goes away when the guest walks off. |
| `build_mode` | A guest's Build panel stays locked (a wrong key is refused); the owner draws a private nook, places a sofa and a whiteboard and saves; the guest gets the new layout at once and the new nook is private; the guest writes on the whiteboard and the owner sees it; the owner deletes the space. |
| `settings_admin` | `/settings` admin gate (wrong / right `ADMIN_PASSCODE`) and the connection values for other apps. Skipped without `ADMIN_PASSCODE`. |

The suites that need a known layout make their own space from a template on
the front page and delete it at the end, so the spaces you use are not touched.

## Running

Use the repo-level runner (it starts and stops the Reflex server and collects artifacts):

```bash
poetry run ./run_test_suite.sh smoke_home
poetry run ./run_test_suite.sh proximity_av
poetry run ./run_test_suite.sh camera_modes
poetry run ./run_test_suite.sh build_mode
ADMIN_PASSCODE=test-pass poetry run ./run_test_suite.sh settings_admin
```

Locally the embedded server needs a `livekit-server` binary on PATH
(`brew install livekit` on macOS; Linux downloads it automatically). If ports
3000/8000 belong to another app, use others: `FRONTEND_PORT=3150 BACKEND_PORT=8150`.
If the media ports are taken (e.g. by the installed `smart-app-nooklane`
container), move them: `LIVEKIT_RTC_TCP_PORT=7591 LIVEKIT_RTC_UDP_PORT=7592`.

To test a deployed instance (e.g. behind re-ddns), run a script directly:

```bash
BASE_URL=https://nooklane.reflex-ddns.com EXPECT_MEDIA_PORT=7582 OUTPUT_DIR=/tmp/nooklane-e2e \
  poetry run python testcases/proximity_av/run_test.py
```

Keep `OUTPUT_DIR` outside the repo when the target is a re-ddns **dev-mode** install of
this checkout: that container watches the mounted source, so screenshots written under
`testcases/` hot-reload its backend in the middle of the test.

Optional env vars:
- `BASE_URL` (default `http://127.0.0.1:3000`) and `BACKEND_URL` (default: `BASE_URL`;
  the runner sets the local backend port)
- `HEADLESS=0` to watch the browsers
- `PW_SLOWMO_MS=100` to slow actions down
- `PW_TIMEOUT_MS=60000` to increase Playwright timeouts
- `EXPECT_MEDIA_PORT=7582` to assert the media server port

Unit tests for the maps and the space store run with `poetry run pytest`.
