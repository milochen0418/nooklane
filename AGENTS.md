# AGENTS.md

This file describes how an AI coding agent (and humans) should work in this repository.

## 0) Always read the docs first

Before making changes or running commands, **read all README.md files in this repo** and follow them.

- Repo overview & dev workflow: `README.md`
- E2E test runner conventions: `testcases/README.md`

If you already read them earlier in the session, **re-check** when unsure.

## 1) Python / Poetry requirements (strict)

This project targets **Python 3.11** (the range allows up to 3.15).

- Prefer Poetry-managed environments.
- If Poetry selected another Python, switch it:

```bash
poetry env use python3.11
poetry env info
poetry install
```

If `python3.11` is not available on PATH, use an absolute path to the 3.11 executable.

## 2) Default rule: use `poetry run` for scripts

When running any repo scripts, prefer:

- `poetry run <command>`

This ensures the correct virtualenv + dependencies are used.

## 3) Running the app: prefer `reflex_rerun.sh`

When you need to start/restart the Reflex app during development, **prefer the repo helper script**.

Typical usage:

```bash
poetry run ./reflex_rerun.sh
```

Notes:
- Prefer `poetry run ./reflex_rerun.sh` over `poetry run reflex run`.
- It runs on the expected ports: frontend `3000`, backend `8000`, and stops the detached `livekit-server` (`7580`) so the restarted backend starts a fresh one.
- Other apps on this machine may own 3000/8000. Then run on other ports and point the frontend at the backend: `REFLEX_API_URL=http://localhost:8150 poetry run reflex run --frontend-port 3150 --backend-port 8150`.

## 4) Running E2E suites: prefer `run_test_suite.sh`

E2E suites live under `testcases/<suite_name>/run_test.py`.

Do **not** run Playwright suites by starting/stopping the server manually unless you have to.
Use the repo runner, which starts/stops the Reflex server, sets `OUTPUT_DIR` and collects artifacts:

```bash
poetry run ./run_test_suite.sh smoke_home
```

Optional environment variables (see `testcases/README.md`): `BASE_URL`, `BACKEND_URL`,
`FRONTEND_PORT` / `BACKEND_PORT`, `HEADLESS=0`, `EXPECT_MEDIA_PORT`.

Unit tests: `poetry run pytest`.

## 4.5) How Nooklane is put together

- **The browser does the real-time work.** `assets/nooklane/*.js` (no build step, plain scripts loaded in the page head):
  - `art.js`: all pixel art drawn in code (floors, walls, things, characters). The object table `OBJECTS` must match `OBJECTS` in `nooklane/maps/builder.py` (`tests/test_maps.py` checks it).
  - `world.js`: the map on the canvas, the camera, depth sorting, pathfinding, name tags.
  - `media.js`: the four camera modes (avatar / real face close-up / full picture / off).
  - `client.js`: the LiveKit room, the data packets, and the proximity rules; `window.nooklane`.
  - `editor.js`: Build mode; `previews.js`: thumbnails, character and palette previews.
  - `avatar_face.js`, `face_tracker.js`, `mediapipe/`, `livekit-client.umd.js`: shared with the avatar chat app (`face_tracker.js` here also reports the face box and can read a camera stream it does not own).
- **Reflex keeps the page around it**: the front page, the pre-join screen, toolbar, chat, people, dialogs, Build panel, and the space files. Reflex → JS with `rx.call_script("window.nooklane.…")`; JS → Reflex through the hidden `<input id="nook_bridge">` (`SpaceState.handle_js`).
- Bump `_JS_VERSION` in `nooklane/nooklane.py` when a script in `assets/` changes, so browsers drop cached copies.
- **Proximity is decided in each browser** (`_linkFor` in `client.js`): same private area → full; one of you in a private area → nothing; they stand on a stage → full for everyone; else by distance (full within 2 tiles, silent at 6, subscribed within 7.5, released beyond 9). Tracks are subscribed by hand (`autoSubscribe: false`); `adaptiveStream` stays off so the video layer can be chosen by distance.
- **Positions travel as 10-byte `pos` packets**, expressions as the avatar chat's 60-byte `face` packets (only to the people who can see you); look / mode / status / hand are participant attributes (the token allows `can_update_own_metadata`).
- **Spaces** are JSON files in `NOOKLANE_DATA_DIR` (`nooklane/spaces.py`), outside the repo so writes never hot-reload. A space's build key lives only in its maker's browser (`nooklane_keys` in localStorage) and as a SHA-256 on disk; `ADMIN_PASSCODE` opens every space.
- **Templates** are built in code (`nooklane/maps/templates.py`, `MapBuilder`); run `poetry run pytest tests/test_maps.py` after changing one (every tile must stay reachable).
- Use static icon names: `rx.icon(<Var>)` switches Reflex to lucide's `DynamicIcon`, which loads every icon module (pages fail behind re-ddns nginx).

## 4.6) The embedded LiveKit server

- Self-hosted by design: `nooklane/livekit_server.py` starts `livekit-server` from a Reflex lifespan task. Do not add LiveKit Cloud settings.
- Locally (macOS) the binary must be on PATH: `brew install livekit`. Linux downloads the pinned release automatically.
- It runs detached, so it survives hot reloads; `reflex_rerun.sh` and `run_test_suite.sh` stop it via port `7580`.
- Ports: 7580 (signalling, localhost only), 7581/tcp and 7582/udp (media), below the other LiveKit apps (audio 7880-7882, video 7980-7982, avatar 7780-7782, English 7680-7682).
- If the Docker deployment (`smart-app-nooklane`) runs on the same machine, it owns 7581/7582. Run local copies with `LIVEKIT_RTC_TCP_PORT=7591 LIVEKIT_RTC_UDP_PORT=7592`.
- `backend-paths.txt` sends `/rtc`, `/twirp/` and `/_nooklane/` to the backend behind re-ddns nginx (container restart after changing it).

## 5) Expectations when acting as an agent

- Prefer the smallest, focused change set.
- After code changes, run the closest relevant check (at minimum the related suite via `run_test_suite.sh`).
- Report outcomes: what you ran, pass/fail, and where artifacts/logs were written.

## 6) Smart way to help the Agent to debug

```
poetry run ./reflex_rerun.sh --loglevel debug
```

In the browser console, `window.nooklane.debug()` shows what this browser knows about everyone: position, the link (gain, opacity, blur, pan, distance, video layer), subscriptions and the tile.
