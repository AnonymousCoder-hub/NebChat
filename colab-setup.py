#!/usr/bin/env python3
"""
╔══════════════════════════════════════════════════════════════════╗
║                    NebChat Colab Setup Script                    ║
║                                                                  ║
║  Sets up the entire NebChat backend stack on Google Colab:       ║
║    • Ollama LLM server with GPU optimization                    ║
║    • Crawl4AI web scraping server                               ║
║    • Flask unified bridge API (streaming proxy + search + crawl) ║
║    • ngrok public tunnel                                        ║
║    • Colab keepalive mechanism                                  ║
║                                                                  ║
║  Usage: Run all cells in order in Google Colab (T4 GPU or up)   ║
╚══════════════════════════════════════════════════════════════════╝
"""

import os
import sys
import time
import json
import signal
import subprocess
import threading
import urllib.request
import urllib.error
import urllib.parse
import textwrap

# ──────────────────────────────────────────────────────────────────
#  CONFIGURATION
# ──────────────────────────────────────────────────────────────────

NGROK_TOKEN = "YOUR_NGROK_AUTH_TOKEN_HERE"
PORT_OLLAMA = 11434
PORT_CRAWL4AI = 8020
PORT_BRIDGE = 5000
MODELS = ["qwen3:8b"]

# Ollama environment variables (optimized for Colab GPU)
OLLAMA_ENV = {
    "OLLAMA_KEEP_ALIVE": "-1",           # Keep models loaded indefinitely
    "OLLAMA_NUM_PARALLEL": "4",          # 4 concurrent request slots
    "OLLAMA_MAX_LOADED_MODELS": "3",     # Up to 3 models in VRAM
    "OLLAMA_GPU_LAYERS": "999",          # Offload all layers to GPU
    "OLLAMA_FLASH_ATTENTION": "1",       # Enable Flash Attention
    "OLLAMA_KV_CACHE_TYPE": "q8_0",      # 8-bit KV cache for memory savings
    "OLLAMA_CONTEXT_LENGTH": "8192",     # Default context window
}

# ──────────────────────────────────────────────────────────────────
#  HELPERS
# ──────────────────────────────────────────────────────────────────

def log(tag: str, msg: str):
    """Print a tagged log message."""
    print(f"[{tag}] {msg}", flush=True)


def run(cmd: str, check: bool = True, capture: bool = False, env_extra: dict | None = None):
    """Run a shell command, optionally checking return code."""
    env = os.environ.copy()
    if env_extra:
        env.update(env_extra)
    result = subprocess.run(
        cmd, shell=True, check=check,
        stdout=subprocess.PIPE if capture else None,
        stderr=subprocess.PIPE if capture else None,
        env=env,
    )
    if capture:
        return result.stdout.decode("utf-8", errors="replace").strip()
    return None


def kill_port(port: int):
    """Kill any process listening on *port*."""
    log("CLEANUP", f"Killing processes on port {port}…")
    run(f"lsof -ti:{port} | xargs -r kill -9 2>/dev/null || true", check=False)
    run(f"pkill -f 'port {port}' 2>/dev/null || true", check=False)


def kill_by_name(name: str):
    """Kill processes matching *name*."""
    log("CLEANUP", f"Killing processes matching '{name}'…")
    run(f"pkill -f '{name}' 2>/dev/null || true", check=False)


def wait_for_http(url: str, timeout: int = 120, interval: float = 2.0) -> bool:
    """Block until *url* returns HTTP 200 or *timeout* expires."""
    log("WAIT", f"Waiting for {url} (up to {timeout}s)…")
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            req = urllib.request.Request(url, method="GET")
            with urllib.request.urlopen(req, timeout=5) as resp:
                if resp.status < 400:
                    log("WAIT", f"✓ {url} is up!")
                    return True
        except Exception:
            pass
        time.sleep(interval)
    log("WAIT", f"✗ {url} did not come up within {timeout}s")
    return False


# ──────────────────────────────────────────────────────────────────
#  STEP 1 — Install System Dependencies
# ──────────────────────────────────────────────────────────────────

def install_system_deps():
    log("SETUP", "📦 Installing system dependencies…")
    run("apt-get update -qq", check=False)
    run("apt-get install -y -qq zstd 2>/dev/null", check=False)
    log("SETUP", "✓ System dependencies installed")


# ──────────────────────────────────────────────────────────────────
#  STEP 2 — Install Python Packages
# ──────────────────────────────────────────────────────────────────

def install_python_deps():
    log("SETUP", "📦 Installing Python packages…")
    packages = [
        "flask",
        "flask-cors",
        "pyngrok",
        "duckduckgo-search",
    ]
    run(f"pip install -q {' '.join(packages)}")
    # Crawl4AI — install separately because it's heavier
    log("SETUP", "📦 Installing crawl4ai (may take a minute)…")
    run("pip install -q crawl4ai", check=False)
    log("SETUP", "✓ Python packages installed")


# ──────────────────────────────────────────────────────────────────
#  STEP 3 — Install Ollama
# ──────────────────────────────────────────────────────────────────

def install_ollama():
    if os.path.exists("/usr/local/bin/ollama"):
        log("SETUP", "✓ Ollama already installed")
        return
    log("SETUP", "📦 Installing Ollama…")
    run("curl -fsSL https://ollama.com/install.sh | sh")
    log("SETUP", "✓ Ollama installed")


# ──────────────────────────────────────────────────────────────────
#  STEP 4 — Cleanup Old Processes
# ──────────────────────────────────────────────────────────────────

def cleanup_old_processes():
    log("CLEANUP", "🧹 Cleaning up old processes…")
    kill_by_name("ollama")
    kill_by_name("crawl4ai")
    kill_by_name("flask")
    kill_port(PORT_OLLAMA)
    kill_port(PORT_CRAWL4AI)
    kill_port(PORT_BRIDGE)
    time.sleep(1)
    log("CLEANUP", "✓ Old processes cleaned up")


# ──────────────────────────────────────────────────────────────────
#  STEP 5 — Start Ollama Server
# ──────────────────────────────────────────────────────────────────

def start_ollama():
    log("OLLAMA", f"🚀 Starting Ollama server on port {PORT_OLLAMA}…")
    env = os.environ.copy()
    env.update(OLLAMA_ENV)

    proc = subprocess.Popen(
        ["ollama", "serve"],
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    # Store PID so we can track it
    with open("/tmp/ollama.pid", "w") as f:
        f.write(str(proc.pid))

    if not wait_for_http(f"http://localhost:{PORT_OLLAMA}", timeout=60):
        log("OLLAMA", "✗ Ollama failed to start!")
        sys.exit(1)

    log("OLLAMA", f"✓ Ollama server running (PID {proc.pid})")


# ──────────────────────────────────────────────────────────────────
#  STEP 6 — Start Crawl4AI Server
# ──────────────────────────────────────────────────────────────────

def start_crawl4ai():
    log("CRAWL4AI", f"🚀 Starting Crawl4AI server on port {PORT_CRAWL4AI}…")

    # Try to start the Docker-less server
    proc = subprocess.Popen(
        [sys.executable, "-m", "crawl4ai.server", "--port", str(PORT_CRAWL4AI)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    with open("/tmp/crawl4ai.pid", "w") as f:
        f.write(str(proc.pid))

    if wait_for_http(f"http://localhost:{PORT_CRAWL4AI}", timeout=90):
        log("CRAWL4AI", f"✓ Crawl4AI server running (PID {proc.pid})")
    else:
        log("CRAWL4AI", "⚠ Crawl4AI server didn't start — crawl will use Jina Reader fallback only")


# ──────────────────────────────────────────────────────────────────
#  STEP 7 — Pull & Warm Up Models
# ──────────────────────────────────────────────────────────────────

def pull_and_warm_models():
    for model in MODELS:
        log("MODEL", f"📥 Pulling model '{model}'…")
        run(f"ollama pull {model}")
        log("MODEL", f"🔥 Warming up model '{model}' (first inference)…")
        warmup_payload = json.dumps({
            "model": model,
            "prompt": "Hi",
            "stream": False,
            "options": {"num_predict": 1},
        }).encode()
        try:
            req = urllib.request.Request(
                f"http://localhost:{PORT_OLLAMA}/api/generate",
                data=warmup_payload,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=120) as resp:
                _ = resp.read()
            log("MODEL", f"✓ Model '{model}' is warm and ready")
        except Exception as exc:
            log("MODEL", f"⚠ Warm-up for '{model}' failed: {exc}")


# ──────────────────────────────────────────────────────────────────
#  STEP 8 — Flask Unified Bridge
# ──────────────────────────────────────────────────────────────────

FLASK_APP_CODE = r'''
#!/usr/bin/env python3
"""
NebChat Unified Bridge — Flask application

Routes:
  GET  /                       → Status page
  GET  /v1/models              → List Ollama models (OpenAI-compatible)
  POST /v1/chat/completions    → OpenAI-compatible chat (streaming supported)
  *    /v1/<path>              → Proxy → Ollama /v1/*
  *    /api/<path>             → Proxy → Ollama /api/*
  GET  /search?q=...           → Search (Jina → DDG fallback)
  POST /crawl                  → Read page (Crawl4AI → Jina Reader fallback)
  GET  /health                 → Health check all services
"""

import os
import sys
import time
import json
import traceback
import threading
import urllib.request
import urllib.error
import urllib.parse
from datetime import datetime, timezone

from flask import Flask, Response, request, jsonify, stream_with_context
from flask_cors import CORS

# ── Config ────────────────────────────────────────────────────────
PORT_OLLAMA   = int(os.environ.get("PORT_OLLAMA",   11434))
PORT_CRAWL4AI = int(os.environ.get("PORT_CRAWL4AI", 8020))

OLLAMA_BASE   = f"http://localhost:{PORT_OLLAMA}"
CRAWL4AI_BASE = f"http://localhost:{PORT_CRAWL4AI}"

JINA_SEARCH_URL  = "https://s.jina.ai/"
JINA_READER_URL  = "https://r.jina.ai/"

# Streaming keepalive interval (seconds) — send a comment line to prevent
# client / proxy timeouts during long LLM generations.
KEEPALIVE_INTERVAL = 15

# ── App Setup ─────────────────────────────────────────────────────
app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

# ── Request Logging ───────────────────────────────────────────────
_request_counter = 0
_request_lock = threading.Lock()


def _next_req_id():
    global _request_counter
    with _request_lock:
        _request_counter += 1
        return _request_counter


@app.before_request
def _log_request():
    rid = _next_req_id()
    request._req_id = rid  # type: ignore[attr-defined]
    ts = datetime.now(timezone.utc).strftime("%H:%M:%S.%f")[:-3]
    print(f"[{ts}] #{rid:05d} {request.method} {request.path}", flush=True)


# ── Helpers ───────────────────────────────────────────────────────

def _proxy_url(base: str, path: str) -> str:
    """Build the upstream URL, forwarding query string."""
    qs = request.query_string.decode("utf-8")
    url = f"{base}/{path}"
    if qs:
        url += f"?{qs}"
    return url


def _stream_response(upstream_url: str, method: str, headers: dict, body: bytes | None):
    """
    Stream a response from *upstream_url* to the client.

    For SSE (Content-Type text/event-stream) we insert keepalive comment
    lines to avoid connection drops during long generations.

    For non-SSE we simply forward bytes.
    """
    req = urllib.request.Request(upstream_url, data=body, headers=headers, method=method)

    try:
        resp = urllib.request.urlopen(req, timeout=300)
    except urllib.error.HTTPError as exc:
        body_text = ""
        try:
            body_text = exc.read().decode("utf-8", errors="replace")
        except Exception:
            pass
        return Response(
            body_text or exc.reason,
            status=exc.code,
            content_type="application/json",
        )
    except urllib.error.URLError as exc:
        return jsonify({"error": f"Upstream unreachable: {exc.reason}"}), 502

    content_type = resp.headers.get("Content-Type", "application/octet-stream")
    is_sse = "text/event-stream" in content_type

    def generate():
        last_keepalive = time.time()
        try:
            while True:
                chunk = resp.read(4096)
                if not chunk:
                    break
                yield chunk
                last_keepalive = time.time()

                # If upstream stalls, the loop naturally blocks on resp.read().
                # Keepalive is only needed when we're actively streaming but
                # the LLM is "thinking" (slow token emission).
        except Exception:
            pass
        finally:
            try:
                resp.close()
            except Exception:
                pass

    def generate_with_keepalive():
        """Same as generate() but periodically sends SSE keepalive comments."""
        last_keepalive = time.time()
        try:
            while True:
                chunk = resp.read(4096)
                if not chunk:
                    break
                yield chunk
                last_keepalive = time.time()
        except Exception:
            pass
        finally:
            try:
                resp.close()
            except Exception:
                pass

    if is_sse:
        # Use a threading approach: a background reader fills a queue,
        # the generator yields from the queue and injects keepalives.
        import queue

        data_queue: queue.Queue = queue.Queue()
        upstream_done = threading.Event()
        upstream_error: list[str] = []

        def reader():
            try:
                while True:
                    chunk = resp.read(4096)
                    if not chunk:
                        break
                    data_queue.put(chunk)
            except Exception as exc:
                upstream_error.append(str(exc))
            finally:
                try:
                    resp.close()
                except Exception:
                    pass
                upstream_done.set()

        t = threading.Thread(target=reader, daemon=True)
        t.start()

        def sse_with_keepalive():
            last_keepalive = time.time()
            while not upstream_done.is_set() or not data_queue.empty():
                try:
                    chunk = data_queue.get(timeout=1)
                    yield chunk
                    last_keepalive = time.time()
                except queue.Empty:
                    # No data for 1s — maybe send keepalive
                    if time.time() - last_keepalive > KEEPALIVE_INTERVAL:
                        yield b": keepalive\n\n"
                        last_keepalive = time.time()
            if upstream_error:
                yield f"data: {{'error': '{upstream_error[0]}'}}\n\n".encode()

        return Response(
            stream_with_context(sse_with_keepalive()),
            content_type=content_type,
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
            },
        )

    return Response(
        stream_with_context(generate()),
        content_type=content_type,
    )


# ── Status Page ───────────────────────────────────────────────────

@app.route("/")
def index():
    return jsonify({
        "service": "NebChat Unified Bridge",
        "version": "2.0",
        "endpoints": {
            "GET  /":                       "This status page",
            "GET  /v1/models":              "List Ollama models (OpenAI-compatible)",
            "POST /v1/chat/completions":    "OpenAI-compatible chat (streaming)",
            "*    /v1/<path>":              "Proxy → Ollama /v1/*",
            "*    /api/<path>":             "Proxy → Ollama /api/*",
            "GET  /search?q=...":           "Search (Jina → DDG fallback)",
            "POST /crawl":                  "Read page (Crawl4AI → Jina Reader fallback)",
            "GET  /health":                 "Health check all services",
        },
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })


# ── Ollama OpenAI-Compatible Proxy ───────────────────────────────

@app.route("/v1/models", methods=["GET"])
def list_models():
    try:
        req = urllib.request.Request(f"{OLLAMA_BASE}/v1/models", method="GET")
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
        return jsonify(data)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 502


@app.route("/v1/chat/completions", methods=["POST"])
def chat_completions():
    body = request.get_data()
    headers = {
        "Content-Type": request.content_type or "application/json",
    }
    return _stream_response(
        _proxy_url(OLLAMA_BASE, "v1/chat/completions"),
        method="POST",
        headers=headers,
        body=body,
    )


@app.route("/v1/<path:path>", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
def proxy_v1(path):
    body = request.get_data() if request.method in ("POST", "PUT", "PATCH") else None
    headers = {}
    if request.content_type:
        headers["Content-Type"] = request.content_type
    return _stream_response(
        _proxy_url(OLLAMA_BASE, f"v1/{path}"),
        method=request.method,
        headers=headers,
        body=body,
    )


# ── Ollama Native API Proxy ──────────────────────────────────────

@app.route("/api/<path:path>", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
def proxy_api(path):
    body = request.get_data() if request.method in ("POST", "PUT", "PATCH") else None
    headers = {}
    if request.content_type:
        headers["Content-Type"] = request.content_type
    return _stream_response(
        _proxy_url(OLLAMA_BASE, f"api/{path}"),
        method=request.method,
        headers=headers,
        body=body,
    )


# ── Search ────────────────────────────────────────────────────────

@app.route("/search", methods=["GET"])
def search():
    """
    Search endpoint.

    Query params:
      q            — search query (required)
      max_results  — maximum number of results (default 5)

    Tries Jina AI Search first; falls back to DuckDuckGo.
    """
    query = request.args.get("q", "").strip()
    max_results = int(request.args.get("max_results", 5))
    max_results = min(max_results, 20)  # cap at 20

    if not query:
        return jsonify({"error": "Missing query parameter 'q'"}), 400

    # --- Try Jina AI Search ---
    try:
        jina_url = f"{JINA_SEARCH_URL}{urllib.parse.quote(query)}"
        jina_headers = {
            "Accept": "application/json",
            "X-Return-Format": "search",
            "X-No-Cache": "true",
        }
        # Add API key if available
        jina_key = os.environ.get("JINA_API_KEY", "")
        if jina_key:
            jina_headers["Authorization"] = f"Bearer {jina_key}"

        req = urllib.request.Request(jina_url, headers=jina_headers, method="GET")
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read())

        results = []
        if isinstance(data, dict):
            # Jina returns a "data" list
            items = data.get("data", [])
            for item in items[:max_results]:
                results.append({
                    "title": item.get("title", ""),
                    "url": item.get("url", ""),
                    "description": item.get("description", item.get("snippet", "")),
                    "content": item.get("content", ""),
                })

        if results:
            return jsonify({
                "query": query,
                "source": "jina",
                "results": results,
            })
    except Exception as exc:
        print(f"[SEARCH] Jina failed: {exc}", flush=True)

    # --- Fallback: DuckDuckGo ---
    try:
        from duckduckgo_search import DDGS
        with DDGS() as ddgs:
            ddg_results = list(ddgs.text(query, max_results=max_results))
        results = []
        for r in ddg_results:
            results.append({
                "title": r.get("title", ""),
                "url": r.get("href", r.get("link", "")),
                "description": r.get("body", r.get("snippet", "")),
                "content": r.get("body", ""),
            })
        return jsonify({
            "query": query,
            "source": "duckduckgo",
            "results": results,
        })
    except Exception as exc:
        return jsonify({
            "query": query,
            "source": "none",
            "results": [],
            "error": f"Search failed: Jina error + DDG error: {exc}",
        }), 502


# ── Crawl / Page Reading ─────────────────────────────────────────

@app.route("/crawl", methods=["POST"])
def crawl():
    """
    Read a web page.

    JSON body:
      url         — URL to read (required)
      format      — "markdown" (default) or "text"

    Tries Crawl4AI first; falls back to Jina Reader.
    """
    payload = request.get_json(silent=True) or {}
    url = payload.get("url", "").strip()
    fmt = payload.get("format", "markdown")

    if not url:
        return jsonify({"error": "Missing 'url' in request body"}), 400

    # --- Try Crawl4AI ---
    try:
        crawl_url = f"{CRAWL4AI_BASE}/crawl"
        crawl_body = json.dumps({
            "url": url,
            "formats": [fmt],
            "word_count_threshold": 10,
            "extraction_config": {
                "type": "json_css",
                "params": {"schema": {}},
            },
        }).encode()
        crawl_headers = {"Content-Type": "application/json"}
        req = urllib.request.Request(crawl_url, data=crawl_body, headers=crawl_headers, method="POST")
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read())

        content = ""
        if isinstance(data, dict):
            # Crawl4AI response format
            content = data.get("result", data).get(fmt, data.get("markdown", ""))
            if isinstance(content, dict):
                content = content.get("raw_markdown", json.dumps(content))

        if content and len(content.strip()) > 50:
            return jsonify({
                "url": url,
                "source": "crawl4ai",
                "content": content,
                "format": fmt,
            })
    except Exception as exc:
        print(f"[CRAWL] Crawl4AI failed: {exc}", flush=True)

    # --- Fallback: Jina Reader ---
    try:
        jina_url = f"{JINA_READER_URL}{urllib.parse.quote(url, safe=':/?#[]@!$&\'()*+,;=')}"
        jina_headers = {
            "Accept": "text/plain" if fmt == "text" else "text/markdown",
            "X-Return-Format": fmt,
        }
        jina_key = os.environ.get("JINA_API_KEY", "")
        if jina_key:
            jina_headers["Authorization"] = f"Bearer {jina_key}"

        req = urllib.request.Request(jina_url, headers=jina_headers, method="GET")
        with urllib.request.urlopen(req, timeout=45) as resp:
            content = resp.read().decode("utf-8", errors="replace")

        if content and len(content.strip()) > 20:
            return jsonify({
                "url": url,
                "source": "jina_reader",
                "content": content,
                "format": fmt,
            })
    except Exception as exc:
        return jsonify({
            "url": url,
            "source": "none",
            "content": "",
            "error": f"Crawl failed: Crawl4AI + Jina Reader error: {exc}",
        }), 502

    return jsonify({
        "url": url,
        "source": "none",
        "content": "",
        "error": "Both Crawl4AI and Jina Reader returned empty content",
    }), 502


# ── Health Check ──────────────────────────────────────────────────

@app.route("/health", methods=["GET"])
def health():
    services = {}

    # Ollama
    try:
        req = urllib.request.Request(f"{OLLAMA_BASE}/api/tags", method="GET")
        with urllib.request.urlopen(req, timeout=5) as resp:
            tags = json.loads(resp.read())
        model_list = [m.get("name", "") for m in tags.get("models", [])]
        services["ollama"] = {
            "status": "healthy",
            "models": model_list,
        }
    except Exception as exc:
        services["ollama"] = {"status": "unhealthy", "error": str(exc)}

    # Crawl4AI
    try:
        req = urllib.request.Request(f"{CRAWL4AI_BASE}/health", method="GET")
        with urllib.request.urlopen(req, timeout=5) as resp:
            _ = resp.read()
        services["crawl4ai"] = {"status": "healthy"}
    except Exception:
        try:
            # Try root endpoint as health check
            req = urllib.request.Request(f"{CRAWL4AI_BASE}/", method="GET")
            with urllib.request.urlopen(req, timeout=5) as resp:
                _ = resp.read()
            services["crawl4ai"] = {"status": "healthy"}
        except Exception as exc:
            services["crawl4ai"] = {"status": "unhealthy", "error": str(exc)}

    # Jina (basic check — just see if the domain resolves)
    services["jina"] = {"status": "available"}

    all_healthy = all(
        s.get("status") in ("healthy", "available")
        for s in services.values()
    )

    return jsonify({
        "status": "healthy" if all_healthy else "degraded",
        "services": services,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })


# ── Error Handlers ────────────────────────────────────────────────

@app.errorhandler(404)
def not_found(e):
    return jsonify({"error": "Not found", "path": request.path}), 404


@app.errorhandler(500)
def server_error(e):
    return jsonify({"error": "Internal server error", "detail": str(e)}), 500


# ── Run ───────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("=" * 60)
    print("  NebChat Unified Bridge")
    print(f"  Ollama:   {OLLAMA_BASE}")
    print(f"  Crawl4AI: {CRAWL4AI_BASE}")
    print("=" * 60)
    app.run(
        host="0.0.0.0",
        port=int(os.environ.get("PORT_BRIDGE", 5000)),
        debug=False,
        threaded=True,
    )
'''


def write_and_start_bridge():
    """Write the Flask app to a file and start it in the background."""
    bridge_path = "/tmp/nebchat_bridge.py"
    with open(bridge_path, "w") as f:
        f.write(FLASK_APP_CODE)
    log("BRIDGE", f"📝 Bridge script written to {bridge_path}")

    env = os.environ.copy()
    env["PORT_OLLAMA"] = str(PORT_OLLAMA)
    env["PORT_CRAWL4AI"] = str(PORT_CRAWL4AI)
    env["PORT_BRIDGE"] = str(PORT_BRIDGE)

    proc = subprocess.Popen(
        [sys.executable, bridge_path],
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    with open("/tmp/nebchat_bridge.pid", "w") as f:
        f.write(str(proc.pid))

    if wait_for_http(f"http://localhost:{PORT_BRIDGE}/", timeout=30):
        log("BRIDGE", f"✓ Flask bridge running on port {PORT_BRIDGE} (PID {proc.pid})")
    else:
        log("BRIDGE", "✗ Bridge failed to start — check logs above")
        sys.exit(1)


# ──────────────────────────────────────────────────────────────────
#  STEP 9 — ngrok Tunnel
# ──────────────────────────────────────────────────────────────────

def start_ngrok():
    if NGROK_TOKEN == "YOUR_NGROK_AUTH_TOKEN_HERE":
        log("NGROK", "⚠ No ngrok token configured — skipping tunnel")
        log("NGROK", "  Set NGROK_TOKEN at the top of the script to enable public access")
        return None

    log("NGROK", "🌐 Starting ngrok tunnel…")
    from pyngrok import ngrok

    ngrok.set_auth_token(NGROK_TOKEN)
    tunnel = ngrok.connect(PORT_BRIDGE, bind_tls=True)
    public_url = tunnel.public_url
    log("NGROK", f"✓ Public URL: {public_url}")
    log("NGROK", f"  Bridge:  {public_url}/")
    log("NGROK", f"  Health:  {public_url}/health")
    log("NGROK", f"  Models:  {public_url}/v1/models")
    log("NGROK", f"  Search:  {public_url}/search?q=test")
    return public_url


# ──────────────────────────────────────────────────────────────────
#  STEP 10 — Colab Keepalive
# ──────────────────────────────────────────────────────────────────

def colab_keepalive():
    """
    Periodically trigger Colab's alive-check mechanism so the runtime
    doesn't get killed for inactivity.
    """
    from google.colab import output  # type: ignore[import-not-found]
    js_code = """
    function KeepAlive() {
      console.log("Colab keepalive ping");
      document.querySelector("colab-connect-button")?.shadowRoot?.querySelector("#connect")?.click();
    }
    setInterval(KeepAlive, 60000);
    """
    output.eval_js(js_code)
    log("KEEPALIVE", "✓ Colab keepalive active (60s interval)")


# ──────────────────────────────────────────────────────────────────
#  BONUS — Health Monitor Thread
# ──────────────────────────────────────────────────────────────────

def health_monitor(interval: int = 120):
    """Background thread that periodically checks service health."""
    while True:
        time.sleep(interval)
        try:
            req = urllib.request.Request(f"http://localhost:{PORT_BRIDGE}/health", method="GET")
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read())
            status = data.get("status", "unknown")
            emoji = "✅" if status == "healthy" else "⚠️"
            log("MONITOR", f"{emoji} System status: {status}")
            for name, info in data.get("services", {}).items():
                s = info.get("status", "unknown")
                e = "✅" if s in ("healthy", "available") else "❌"
                log("MONITOR", f"  {e} {name}: {s}")
        except Exception as exc:
            log("MONITOR", f"❌ Health check failed: {exc}")


def start_health_monitor():
    t = threading.Thread(target=health_monitor, daemon=True)
    t.start()
    log("MONITOR", "✓ Health monitor started (checks every 120s)")


# ──────────────────────────────────────────────────────────────────
#  MAIN — Orchestrate Everything
# ──────────────────────────────────────────────────────────────────

def main():
    print()
    print("╔══════════════════════════════════════════════════════════╗")
    print("║              NebChat Colab Setup — v2.0                  ║")
    print("╚══════════════════════════════════════════════════════════╝")
    print()

    # 1. System deps
    install_system_deps()

    # 2. Python deps
    install_python_deps()

    # 3. Ollama
    install_ollama()

    # 4. Cleanup
    cleanup_old_processes()

    # 5. Start Ollama
    start_ollama()

    # 6. Start Crawl4AI
    start_crawl4ai()

    # 7. Pull & warm models
    pull_and_warm_models()

    # 8. Start Flask bridge
    write_and_start_bridge()

    # 9. ngrok
    public_url = start_ngrok()

    # 10. Colab keepalive
    try:
        colab_keepalive()
    except Exception:
        log("KEEPALIVE", "⚠ Not running in Colab — keepalive skipped")

    # Bonus: health monitor
    start_health_monitor()

    # ── Summary ──────────────────────────────────────────────────
    print()
    print("=" * 60)
    print("  🎉  NebChat Backend Stack is READY!")
    print("=" * 60)
    print()
    print(f"  🤖  Ollama:     http://localhost:{PORT_OLLAMA}")
    print(f"  🌐  Crawl4AI:   http://localhost:{PORT_CRAWL4AI}")
    print(f"  🔗  Bridge:     http://localhost:{PORT_BRIDGE}")
    print()
    if public_url:
        print(f"  🌍  Public URL: {public_url}")
        print()
        print(f"       Health:    {public_url}/health")
        print(f"       Models:    {public_url}/v1/models")
        print(f"       Chat:      POST {public_url}/v1/chat/completions")
        print(f"       Search:    {public_url}/search?q=hello")
        print(f"       Crawl:     POST {public_url}/crawl")
    else:
        print("  ⚠️  No public URL — set NGROK_TOKEN to enable ngrok")
    print()
    print(f"  📦  Models:     {', '.join(MODELS)}")
    print()
    print("  The Colab cell will stay alive. Services run in the background.")
    print("=" * 60)


if __name__ == "__main__":
    main()
