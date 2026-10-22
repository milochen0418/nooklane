"""Embedded, self-hosted LiveKit server.

LiveKit's media server is open source (Apache-2.0,
https://github.com/livekit/livekit).  This module runs it *inside the app's
own container*, next to the Reflex backend, so Nooklane needs no LiveKit Cloud
account and no LiveKit settings:

* binary  - ``livekit-server`` from ``LIVEKIT_SERVER_BIN`` or PATH (e.g.
            ``brew install livekit`` on macOS); on Linux the pinned GitHub
            release is downloaded once and checked against its checksums.txt.
* keys    - ``LIVEKIT_API_KEY`` / ``LIVEKIT_API_SECRET`` when both are set,
            otherwise a random pair generated once and persisted.
* network - signalling (port 7580) listens on 127.0.0.1 only; browsers reach
            it through the Reflex backend's ``/rtc`` relay (``livekit_proxy``),
            i.e. through re-ddns nginx + TLS.  Media (voices, cameras, screens
            and the position / face data packets) uses ICE/TCP 7581 and the
            ICE/UDP mux 7582, which must be published on the Docker host, and
            the address advertised to browsers (``rtc.node_ip``) is the host's
            LAN IP (``EXTERNAL_IP``, passed in by re-ddns).

The ports sit below the other LiveKit apps of the catalog (audio 7880-7882,
video 7980-7982, avatar 7780-7782, English 7680-7682), so they can all run on
the same host, each with its own server.

The server runs detached from the backend worker so it survives Reflex hot
reloads.  A state file records its PID and a hash of its config; a running
server is reused while the wanted config is unchanged and restarted when it
changes (e.g. the admin sets a new node IP on /settings).
"""

from __future__ import annotations

import asyncio
import contextlib
import fcntl
import hashlib
import io
import ipaddress
import json
import logging
import os
import platform
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import tarfile
import time
from pathlib import Path

import httpx

from nooklane.paths import DATA_DIR

logger = logging.getLogger(__name__)

VERSION = os.environ.get("LIVEKIT_SERVER_VERSION", "1.13.7")
SIGNAL_PORT = int(os.environ.get("LIVEKIT_PORT", "7580"))
RTC_TCP_PORT = int(os.environ.get("LIVEKIT_RTC_TCP_PORT", "7581"))
RTC_UDP_PORT = int(os.environ.get("LIVEKIT_RTC_UDP_PORT", "7582"))

_RELEASE_URL = "https://github.com/livekit/livekit/releases/download/v{version}"
_ARCH = {
    "x86_64": "amd64",
    "amd64": "amd64",
    "aarch64": "arm64",
    "arm64": "arm64",
    "armv7l": "armv7",
}
_LOG_MAX_BYTES = 5 * 1024 * 1024


# Runtime files live outside the project dir so they never trigger hot reload.
HOME = Path(os.environ.get("LIVEKIT_HOME") or DATA_DIR / "livekit")
_CONFIG_PATH = HOME / "livekit.yaml"
_LOG_PATH = HOME / "livekit-server.log"
_STATE_PATH = HOME / "server.json"
_SETTINGS_PATH = HOME / "settings.json"
_KEYS_PATH = HOME / "keys.json"


# ---------------------------------------------------------------------------
# Small file helpers
# ---------------------------------------------------------------------------

@contextlib.contextmanager
def _file_lock(name: str):
    """Inter-process lock (backend workers, hot-reloaded workers)."""
    HOME.mkdir(parents=True, exist_ok=True)
    with open(HOME / name, "a") as fh:
        fcntl.flock(fh, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(fh, fcntl.LOCK_UN)


def _read_json(path: Path) -> dict:
    try:
        data = json.loads(path.read_text())
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _write_json(path: Path, data: dict, *, private: bool = False) -> None:
    HOME.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    # Private files (keys, config with the secret) are never readable by others.
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600 if private else 0o644)
    with os.fdopen(fd, "w") as fh:
        json.dump(data, fh, indent=2)
    os.replace(tmp, path)


def _update_state(**fields) -> None:
    state = _read_json(_STATE_PATH)
    state.update(fields, updated_at=time.time())
    _write_json(_STATE_PATH, state)


# ---------------------------------------------------------------------------
# Settings: keys, node IP
# ---------------------------------------------------------------------------

def api_credentials() -> tuple[str, str]:
    """API key/secret shared by the server config and token minting."""
    key = os.environ.get("LIVEKIT_API_KEY", "").strip()
    secret = os.environ.get("LIVEKIT_API_SECRET", "").strip()
    if key and secret:
        return key, secret
    with _file_lock("keys.lock"):
        data = _read_json(_KEYS_PATH)
        if not (data.get("api_key") and data.get("api_secret")):
            data = {
                "api_key": "API" + secrets.token_hex(6),
                # livekit-server wants secrets of at least 32 characters.
                "api_secret": secrets.token_urlsafe(32),
            }
            _write_json(_KEYS_PATH, data, private=True)
        return data["api_key"], data["api_secret"]


def load_settings() -> dict:
    """Admin overrides saved from the /settings page."""
    return _read_json(_SETTINGS_PATH)


def save_settings(**fields) -> None:
    settings = load_settings()
    settings.update(fields)
    _write_json(_SETTINGS_PATH, settings)


def valid_ip(value: str) -> bool:
    try:
        ipaddress.ip_address(value)
        return True
    except ValueError:
        return False


def node_ip() -> tuple[str, str]:
    """The IP advertised to browsers for media, and where it came from.

    Returns ``("", "auto")`` when nothing is configured: livekit-server then
    advertises its own interface addresses, which is right for a plain local
    run but not inside Docker (browsers cannot reach container IPs).
    """
    override = str(load_settings().get("node_ip", "")).strip()
    if override and valid_ip(override):
        return override, "settings"
    for var in ("LIVEKIT_NODE_IP", "EXTERNAL_IP"):
        value = os.environ.get(var, "").strip()
        if value and valid_ip(value):
            return value, var
    return "", "auto"


def build_config() -> dict:
    """livekit-server config (written as JSON, which is valid YAML)."""
    key, secret = api_credentials()
    ip, _source = node_ip()
    rtc: dict = {
        "tcp_port": RTC_TCP_PORT,
        "udp_port": RTC_UDP_PORT,
        # node_ip only takes effect when use_external_ip is off (config-sample.yaml).
        "use_external_ip": False,
    }
    if ip:
        rtc["node_ip"] = ip
    return {
        "port": SIGNAL_PORT,
        "bind_addresses": ["127.0.0.1"],
        "rtc": rtc,
        "keys": {key: secret},
        "logging": {"level": os.environ.get("LIVEKIT_LOG_LEVEL", "info")},
        "room": {"empty_timeout": 300, "departure_timeout": 20},
    }


# ---------------------------------------------------------------------------
# Binary
# ---------------------------------------------------------------------------

def _download(dest: Path) -> None:
    arch = _ARCH.get(platform.machine().lower())
    if not arch:
        msg = f"No LiveKit release for CPU architecture {platform.machine()!r}"
        raise RuntimeError(msg)
    asset = f"livekit_{VERSION}_linux_{arch}.tar.gz"
    base = _RELEASE_URL.format(version=VERSION)
    logger.info("Downloading %s/%s", base, asset)
    with httpx.Client(follow_redirects=True, timeout=120.0) as client:
        sums = client.get(f"{base}/checksums.txt")
        sums.raise_for_status()
        expected = next(
            (line.split()[0] for line in sums.text.splitlines() if line.strip().endswith(asset)),
            "",
        )
        archive = client.get(f"{base}/{asset}")
        archive.raise_for_status()
    digest = hashlib.sha256(archive.content).hexdigest()
    if not expected or digest != expected:
        msg = f"Checksum mismatch for {asset} (expected {expected or 'none'}, got {digest})"
        raise RuntimeError(msg)
    with tarfile.open(fileobj=io.BytesIO(archive.content), mode="r:gz") as tar:
        try:
            member = tar.extractfile("livekit-server")
        except KeyError:
            member = None
        if member is None:
            msg = f"livekit-server not found in {asset}"
            raise RuntimeError(msg)
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_name(dest.name + ".tmp")
        tmp.write_bytes(member.read())
    tmp.chmod(0o755)
    os.replace(tmp, dest)
    logger.info("Installed livekit-server %s at %s", VERSION, dest)


def resolve_binary() -> str:
    explicit = os.environ.get("LIVEKIT_SERVER_BIN", "").strip()
    if explicit:
        if os.access(explicit, os.X_OK):
            return explicit
        msg = f"LIVEKIT_SERVER_BIN is not an executable file: {explicit}"
        raise RuntimeError(msg)
    found = shutil.which("livekit-server")
    if found:
        return found
    cached = HOME / "bin" / f"livekit-server-{VERSION}"
    if cached.exists():
        return str(cached)
    if sys.platform != "linux":
        msg = "livekit-server not found on PATH. On macOS install it with: brew install livekit"
        raise RuntimeError(msg)
    _update_state(phase="downloading", error="", version=VERSION)
    _download(cached)
    return str(cached)


def _binary_version(binary: str) -> str:
    try:
        out = subprocess.run(
            [binary, "--version"], capture_output=True, text=True, timeout=10,
        ).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return ""
    # "livekit-server version 1.13.7"
    return out.rsplit(" ", 1)[-1] if out else ""


# ---------------------------------------------------------------------------
# Process
# ---------------------------------------------------------------------------

def _pid_alive(pid: int) -> bool:
    with contextlib.suppress(ChildProcessError, OSError):
        done, _status = os.waitpid(pid, os.WNOHANG)  # reaps it if it is our child
        if done == pid:
            return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    with contextlib.suppress(OSError, IndexError):
        stat = Path(f"/proc/{pid}/stat").read_text()
        if stat.rsplit(")", 1)[1].split()[0] == "Z":  # zombie
            return False
    return True


def _cmdline(pid: int) -> str:
    proc = Path(f"/proc/{pid}/cmdline")
    if proc.exists():
        with contextlib.suppress(OSError):
            return proc.read_bytes().replace(b"\0", b" ").decode(errors="ignore")
        return ""
    with contextlib.suppress(OSError, subprocess.SubprocessError):
        return subprocess.run(
            ["ps", "-o", "command=", "-p", str(pid)],
            capture_output=True, text=True, timeout=5,
        ).stdout
    return ""


def _is_our_server(pid: int | None) -> bool:
    """True only for a live livekit-server started with our config file.

    Guards against PID reuse (e.g. after a container restart) so we never
    signal an unrelated process.
    """
    if not pid or not _pid_alive(pid):
        return False
    cmd = _cmdline(pid)
    return "livekit-server" in cmd and str(_CONFIG_PATH) in cmd


def _terminate(pid: int) -> None:
    # livekit-server's first signal drains gracefully: it waits for participants
    # to leave, and is ignored if it lands while the server is still starting.
    # A second signal forces the stop (cmd/server/main.go).
    for sig, wait_s in ((signal.SIGTERM, 3), (signal.SIGTERM, 3), (signal.SIGKILL, 2)):
        with contextlib.suppress(ProcessLookupError):
            os.kill(pid, sig)
        deadline = time.time() + wait_s
        while time.time() < deadline:
            if not _pid_alive(pid):
                return
            time.sleep(0.1)


def _port_in_use(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.5)
        return sock.connect_ex(("127.0.0.1", port)) == 0


def healthy() -> bool:
    try:
        r = httpx.get(f"http://127.0.0.1:{SIGNAL_PORT}/", timeout=1.0, trust_env=False)
        return r.status_code == 200
    except httpx.HTTPError:
        return False


def _config_hash(config: dict, binary: str) -> str:
    raw = json.dumps({"config": config, "binary": binary}, sort_keys=True)
    return hashlib.sha256(raw.encode()).hexdigest()


def _open_log():
    HOME.mkdir(parents=True, exist_ok=True)
    if _LOG_PATH.exists() and _LOG_PATH.stat().st_size > _LOG_MAX_BYTES:
        _LOG_PATH.replace(_LOG_PATH.with_name(_LOG_PATH.name + ".1"))
    return open(_LOG_PATH, "ab")


def _last_log_line(offset: int) -> str:
    """Last line livekit-server logged since *offset* (e.g. why it exited)."""
    try:
        with open(_LOG_PATH, "rb") as fh:
            fh.seek(offset)
            lines = fh.read().decode(errors="replace").strip().splitlines()
    except OSError:
        return ""
    return lines[-1].strip()[:300] if lines else ""


def ensure_running(*, restart: bool = False) -> bool:
    """Start livekit-server unless ours is already up with the wanted config.

    Blocking (download, process start); call it via ``asyncio.to_thread``.
    Returns True when the server is healthy afterwards.
    """
    with _file_lock("server.lock"):
        state = _read_json(_STATE_PATH)
        try:
            binary = resolve_binary()
            config = build_config()
        except Exception as exc:  # noqa: BLE001 - surfaced in the UI
            logger.error("LiveKit server unavailable: %s", exc)
            _update_state(phase="error", error=str(exc))
            return False

        wanted = _config_hash(config, binary)
        pid = state.get("pid")
        ours = _is_our_server(pid)
        if ours and not restart and state.get("config_hash") == wanted and healthy():
            if state.get("phase") != "running":
                _update_state(phase="running", error="")
            return True

        if ours:
            logger.info("Stopping livekit-server (pid %s) to apply new config", pid)
            _terminate(pid)
        if _port_in_use(SIGNAL_PORT):
            msg = f"Port {SIGNAL_PORT} is already used by another process (not started by this app)"
            logger.error(msg)
            _update_state(phase="error", error=msg, pid=None)
            return False

        _write_json(_CONFIG_PATH, config, private=True)
        version = _binary_version(binary) or VERSION
        with _open_log() as log:
            log_start = log.tell()
            proc = subprocess.Popen(
                [binary, "--config", str(_CONFIG_PATH)],
                stdin=subprocess.DEVNULL,
                stdout=log,
                stderr=subprocess.STDOUT,
                cwd=HOME,
                # Own session: survives backend hot reloads (see module docstring).
                start_new_session=True,
            )
        _update_state(
            phase="starting", error="", pid=proc.pid, config_hash=wanted,
            binary=binary, version=version, started_at=time.time(),
        )
        logger.info("Started livekit-server %s (pid %s), node_ip=%s",
                    version, proc.pid, config["rtc"].get("node_ip", "auto"))

        deadline = time.time() + 30
        while time.time() < deadline:
            if proc.poll() is not None:
                # e.g. "listen udp 172.20.10.3:7782: bind: address already in use"
                reason = _last_log_line(log_start) or "see the server log"
                msg = f"livekit-server exited (code {proc.returncode}): {reason}"
                logger.error(msg)
                _update_state(phase="error", error=msg, pid=None)
                return False
            if healthy():
                _update_state(phase="running", error="")
                return True
            time.sleep(0.3)
        _update_state(phase="error", error="livekit-server did not answer on port "
                                            f"{SIGNAL_PORT} within 30s")
        return False


async def supervise() -> None:
    """Keep the server up for as long as the backend runs."""
    if node_ip()[1] == "auto" and Path("/.dockerenv").exists():
        logger.warning(
            "Running in Docker without LIVEKIT_NODE_IP/EXTERNAL_IP: browsers will "
            "get container-internal media addresses and calls will not connect."
        )
    while True:
        try:
            ok = await asyncio.to_thread(ensure_running)
        except Exception:  # noqa: BLE001 - keep supervising
            logger.exception("LiveKit supervisor iteration failed")
            ok = False
        await asyncio.sleep(5 if ok else 30)


@contextlib.asynccontextmanager
async def lifespan():
    """Reflex lifespan task: supervise the server, but leave it running on exit."""
    task = asyncio.create_task(supervise())
    try:
        yield
    finally:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task


# ---------------------------------------------------------------------------
# Status for the UI
# ---------------------------------------------------------------------------

def status() -> dict[str, str]:
    """Snapshot for the UI; safe to call from any backend worker."""
    state = _read_json(_STATE_PATH)
    phase = state.get("phase") or "starting"
    is_up = healthy()
    if phase == "running" and not is_up:
        phase = "starting"  # crashed; the supervisor restarts it within seconds
    ip, source = node_ip()
    started = state.get("started_at")
    return {
        "phase": phase,
        "message": str(state.get("error") or ""),
        "version": str(state.get("version") or VERSION),
        "binary": str(state.get("binary") or ""),
        "pid": str(state.get("pid") or ""),
        "started_at": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(started)) if started else "",
        "node_ip": ip or "auto",
        "node_ip_source": source,
        "signal_port": str(SIGNAL_PORT),
        "tcp_port": str(RTC_TCP_PORT),
        "udp_port": str(RTC_UDP_PORT),
    }


def restart() -> bool:
    return ensure_running(restart=True)


def log_tail(lines: int = 60) -> str:
    try:
        with open(_LOG_PATH, "rb") as fh:
            fh.seek(0, os.SEEK_END)
            fh.seek(max(0, fh.tell() - 64 * 1024))
            text = fh.read().decode(errors="replace")
    except OSError:
        return ""
    # Some info lines carry whole SDPs; keep the tail readable.
    tail = text.splitlines()[-lines:]
    return "\n".join(line if len(line) <= 300 else line[:300] + " …" for line in tail)
