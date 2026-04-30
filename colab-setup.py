#!/usr/bin/env python3
"""
NebChat v5.2 — Ollama + Playwright + Flask Bridge + ngrok
Playwright ONLY for search & content. No fallbacks, no bloat.
Paste this ENTIRE script in a single Colab cell and run.
"""

import os
import sys
import subprocess

# ─────────────────────────────────────────────
# STEP 1: Install ALL dependencies FIRST
# (must happen before any imports that need them)
# ─────────────────────────────────────────────
def install_deps():
    """Install everything needed before we import anything."""
    print("📦 Installing dependencies...")

    # System deps
    if not os.path.exists("/usr/bin/zstd"):
        os.system("apt-get update -y && apt-get install -y zstd")

    # Python packages
    pip_pkgs = [
        "flask",
        "flask-cors",
        "pyngrok",
        "requests",
        "playwright",
    ]
    for pkg in pip_pkgs:
        mod_name = pkg.replace("-", "_")
        try:
            __import__(mod_name)
            print(f"  ✅ {pkg} already installed")
        except ImportError:
            print(f"  ⬇️ Installing {pkg}...")
            subprocess.run(
                [sys.executable, "-m", "pip", "install", "-q", pkg],
                check=True,
            )

    # Playwright browser + system deps
    print("📦 Setting up Playwright browser...")
    os.system("playwright install chromium 2>/dev/null || true")
    os.system("playwright install-deps chromium 2>/dev/null || true")

    # Ollama
    if not os.path.exists("/usr/local/bin/ollama"):
        print("⬇️ Installing Ollama...")
        os.system("curl -fsSL https://ollama.com/install.sh | sh")
        os.environ["PATH"] += ":/usr/local/bin"
    else:
        print("  ✅ Ollama already installed")

    print("✅ All dependencies ready!\n")


# ═══════════════════════════════════════════════
# RUN install_deps() AT MODULE LEVEL NOW
# This guarantees packages are installed BEFORE
# the imports below this line execute.
# ═══════════════════════════════════════════════
install_deps()

# ─────────────────────────────────────────────
# STEP 2: NOW we can safely import everything
# (these run AFTER install_deps() completes)
# ─────────────────────────────────────────────
import json
import time
import shutil
import queue
import threading
import urllib.request
import urllib.error
import urllib.parse
from datetime import datetime, timezone

from flask import Flask, Response, request, jsonify, stream_with_context
from flask_cors import CORS
import requests as req_lib


# ─────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────
NGROK_TOKEN = "3CPKOAZmMaygc9VlRuHwSXcOXNe_7apUcU4vTgGZ7V3Vttr6T"
OLLAMA_PORT = 11434
BRIDGE_PORT = 5000
MODELS = ["qwen3.5:9b", "qwen3.5:0.8b"]
MAX_ROUNDS = 10

OLLAMA_URL = f"http://localhost:{OLLAMA_PORT}"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)

OLLAMA_ENV = {
    "OLLAMA_KEEP_ALIVE": "-1",
    "OLLAMA_NUM_PARALLEL": "4",
    "OLLAMA_MAX_LOADED_MODELS": "3",
    "OLLAMA_GPU_LAYERS": "999",
    "OLLAMA_FLASH_ATTENTION": "1",
    "OLLAMA_KV_CACHE_TYPE": "q8_0",
    "OLLAMA_CONTEXT_LENGTH": "8192",
}


# ─────────────────────────────────────────────
# OLLAMA MANAGEMENT
# ─────────────────────────────────────────────
def cleanup_old_processes():
    """Kill any leftover processes from previous runs."""
    print("🧹 Cleaning up old processes...")
    for proc in ["ollama", "ngrok", "nebchat"]:
        os.system(f"pkill -9 -f {proc} 2>/dev/null")
    for port in [OLLAMA_PORT, BRIDGE_PORT]:
        os.system(f"fuser -k {port}/tcp 2>/dev/null")
    time.sleep(2)


def start_ollama():
    """Start Ollama server and wait for it to be ready."""
    env = os.environ.copy()
    env.update(OLLAMA_ENV)
    print("🚀 Starting Ollama...")
    subprocess.Popen(
        ["ollama", "serve"],
        stdout=subprocess.DEVNULL,
        stderr=open("/content/ollama.log", "w"),
        env=env,
    )
    for _ in range(30):
        try:
            req_lib.get(f"http://127.0.0.1:{OLLAMA_PORT}/api/tags", timeout=2)
            print("✅ Ollama is running!\n")
            return
        except Exception:
            time.sleep(1)
    raise RuntimeError("❌ Ollama failed to start")


def ensure_models():
    """Pull required models if not already present."""
    print("📥 Checking models...")
    try:
        existing = [
            m["name"]
            for m in req_lib.get(f"http://127.0.0.1:{OLLAMA_PORT}/api/tags").json().get("models", [])
        ]
    except Exception:
        existing = []

    for model in MODELS:
        if not any(model in x for x in existing):
            print(f"  ⬇️ Pulling {model}...")
            subprocess.run(["ollama", "pull", model], check=True)
        else:
            print(f"  ✅ {model} ready")


def warmup_models():
    """Pre-load models into GPU memory."""
    print("🔥 Warming up models...")
    for model in MODELS:
        try:
            req_lib.post(
                f"http://127.0.0.1:{OLLAMA_PORT}/api/generate",
                json={"model": model, "prompt": "hi", "stream": False},
                timeout=240,
            )
        except Exception:
            pass
    print("✅ Models warmed up!\n")


# ─────────────────────────────────────────────
# FLASK APP
# ─────────────────────────────────────────────
app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

_request_count = 0
_request_lock = threading.Lock()


@app.before_request
def log_request():
    global _request_count
    with _request_lock:
        _request_count += 1
    ts = datetime.now(timezone.utc).strftime("%H:%M:%S")
    print(f"[{ts}] #{_request_count:05d} {request.method} {request.path}", flush=True)


# ─────────────────────────────────────────────
# PLAYWRIGHT — the ONLY engine
# ─────────────────────────────────────────────
_browser = None
_browser_lock = threading.Lock()


def get_browser():
    """Lazy-initialize a single shared Playwright browser instance."""
    global _browser
    if _browser is not None:
        return _browser

    with _browser_lock:
        if _browser is not None:
            return _browser
        try:
            from playwright.sync_api import sync_playwright

            pw = sync_playwright().start()
            _browser = pw.chromium.launch(
                headless=True,
                args=[
                    "--no-sandbox",
                    "--disable-setuid-sandbox",
                    "--disable-dev-shm-usage",
                    "--disable-gpu",
                    "--disable-extensions",
                    "--single-process",
                ],
            )
            print("[PW] Browser launched", flush=True)
        except Exception as e:
            print(f"[PW] Failed to launch browser: {e}", flush=True)
            _browser = None

    return _browser


def search_web(query, max_results=10):
    """Search Bing via Playwright. One engine, zero fallbacks."""
    browser = get_browser()
    if not browser:
        return json.dumps({"error": "Browser not available"})

    ctx = None
    try:
        ctx = browser.new_context(
            user_agent=USER_AGENT,
            viewport={"width": 1280, "height": 720},
            locale="en-US",
        )
        page = ctx.new_page()
        search_url = (
            f"https://www.bing.com/search?q={urllib.parse.quote(query)}"
            f"&count={max_results}&setlang=en&cc=US"
        )
        page.goto(search_url, timeout=15000, wait_until="domcontentloaded")
        page.wait_for_timeout(2000)

        # Check for captcha
        is_captcha = page.evaluate(
            "() => {"
            "  const t = document.body.innerText || '';"
            "  return t.includes('captcha') || t.includes('verify you are human');"
            "}"
        )
        if is_captcha:
            ctx.close()
            return json.dumps({"error": "Captcha detected — try again later"})

        # Extract results
        results = page.evaluate(
            "(n) => ["
            "  ...document.querySelectorAll('#b_results li.b_algo')"
            "].slice(0, n).map(li => ({"
            "  title: li.querySelector('h2 a')?.textContent?.trim() || '',"
            "  url: li.querySelector('h2 a')?.href || '',"
            "  snippet: li.querySelector('.b_caption p, .b_lineclamp2, p')?.textContent?.trim() || ''"
            "}))",
            max_results,
        )
        ctx.close()
        ctx = None

        if results:
            for r in results:
                r["snippet"] = (r.get("snippet", "") or "")[:500]
            print(f"[SEARCH] {len(results)} results for '{query[:40]}'", flush=True)
            return json.dumps(results)

    except Exception as e:
        print(f"[SEARCH] Error: {e}", flush=True)

    if ctx:
        try:
            ctx.close()
        except Exception:
            pass

    return json.dumps({"error": "Search failed"})


def read_page(url, max_chars=8000):
    """Read any webpage via Playwright. Handles JS-rendered content perfectly."""
    browser = get_browser()
    if not browser:
        return "Browser not available"

    ctx = None
    try:
        ctx = browser.new_context(
            user_agent=USER_AGENT,
            viewport={"width": 1280, "height": 720},
        )
        page = ctx.new_page()
        page.goto(url, timeout=20000, wait_until="domcontentloaded")
        page.wait_for_timeout(2000)

        # Extract main content (tries semantic selectors first, falls back to body)
        text = page.evaluate(
            "(mc) => {"
            "  const selectors = ["
            "    '#mw-content-text', 'article', 'main',"
            "    '[role=\"main\"]', '.post-content', '.article-body',"
            "    '#content', '.content'"
            "  ];"
            "  let main;"
            "  for (const sel of selectors) {"
            "    const el = document.querySelector(sel);"
            "    if (el && el.innerText.length > 100) { main = el; break; }"
            "  }"
            "  if (!main) main = document.body;"
            "  const clone = main.cloneNode(true);"
            "  clone.querySelectorAll("
            "    'script, style, nav, footer, header, aside, iframe, "
            "noscript, .ad, .cookie-banner, .popup, .modal, .sidebar'"
            "  ).forEach(e => e.remove());"
            "  return (clone.innerText || clone.textContent || '').substring(0, mc);"
            "}",
            max_chars,
        )
        ctx.close()
        ctx = None

        if text and len(text.strip()) > 50:
            print(f"[READ] {len(text)} chars from {url[:60]}", flush=True)
            return text

    except Exception as e:
        print(f"[READ] Error: {e}", flush=True)

    if ctx:
        try:
            ctx.close()
        except Exception:
            pass

    return "Failed to read page."


def execute_tool(name, args):
    """Dispatch a tool call to the right function."""
    if name == "web_search":
        return search_web(args.get("query", ""))
    if name == "read_page":
        return read_page(args.get("url", ""))
    return json.dumps({"error": f"Unknown tool: {name}"})


# ─────────────────────────────────────────────
# AGENTIC LOOP
# ─────────────────────────────────────────────
TOOL_DEFINITIONS = [
    {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": "Search the web for current info via headless browser",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string"}},
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_page",
            "description": "Read full page content from any URL. Handles JS-rendered pages perfectly.",
            "parameters": {
                "type": "object",
                "properties": {"url": {"type": "string"}},
                "required": ["url"],
            },
        },
    },
]

SYSTEM_PROMPT = """You are an AI with web search and page reading tools powered by a headless browser. You can search and read any webpage.

RULES:
1) For time-sensitive queries (prices, news, weather), MUST web_search FIRST
2) After searching, use read_page on relevant URLs for detailed content
3) Search as many times as needed with refined queries
4) Read as many pages as needed — no limits
5) Never say you can't browse — you CAN search and read any page
6) Cite sources with URLs
7) Keep searching and reading until you have complete, accurate data"""


def call_ollama(body):
    """Non-streaming call to Ollama."""
    body["stream"] = False
    req = urllib.request.Request(
        f"{OLLAMA_URL}/v1/chat/completions",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    resp = urllib.request.urlopen(req, timeout=300)
    return json.loads(resp.read())


def make_sse_chunk(chat_id, created, model, delta):
    """Build a single SSE chunk string."""
    chunk = {
        "id": chat_id,
        "object": "chat.completion.chunk",
        "created": created,
        "model": model,
        "choices": [{"index": 0, "delta": delta, "finish_reason": None}],
    }
    return f"data: {json.dumps(chunk)}\n\n"


def handle_agentic(body, stream):
    """Run the agentic tool-calling loop."""
    messages = list(body.get("messages", []))
    model = body.get("model", "qwen3:8b")

    # Inject system prompt
    has_system = any(m.get("role") == "system" for m in messages)
    if not has_system:
        messages.insert(0, {"role": "system", "content": SYSTEM_PROMPT})
    else:
        for m in messages:
            if m.get("role") == "system":
                m["content"] = SYSTEM_PROMPT + "\n\n" + m.get("content", "")
                break

    body["tools"] = TOOL_DEFINITIONS
    body["tool_choice"] = "auto"

    # ── Non-streaming ──
    if not stream:
        resp = None
        for _ in range(MAX_ROUNDS):
            body["messages"] = messages
            try:
                resp = call_ollama(body)
            except Exception as e:
                return jsonify({"error": str(e)}), 502

            msg = resp["choices"][0]["message"]
            if not msg.get("tool_calls"):
                break

            messages.append(msg)
            for tc in msg["tool_calls"]:
                tool_result = execute_tool(
                    tc["function"]["name"],
                    json.loads(tc["function"].get("arguments", "{}")),
                )
                messages.append({
                    "role": "tool",
                    "tool_call_id": tc.get("id", ""),
                    "content": tool_result,
                })

        if resp:
            return jsonify(resp)
        return jsonify({"error": "No response"}), 502

    # ── Streaming ──
    def generate():
        chat_id = f"chatcmpl-{int(time.time() * 1000)}"
        created = int(time.time())
        resp = None

        for round_num in range(MAX_ROUNDS):
            body["messages"] = messages
            try:
                resp = call_ollama(body)
            except Exception as e:
                yield make_sse_chunk(chat_id, created, model, {"content": f"\n\n⚠️ {e}"})
                yield "data: [DONE]\n\n"
                return

            msg = resp["choices"][0]["message"]
            tool_calls = msg.get("tool_calls", [])

            if not tool_calls:
                break

            messages.append(msg)

            for tc in tool_calls:
                fn = tc["function"]
                tool_name = fn["name"]
                tool_args = json.loads(fn.get("arguments", "{}"))
                tool_id = tc.get("id", "")

                print(f"[AG] R{round_num+1}: {tool_name}({json.dumps(tool_args)[:60]})", flush=True)

                # Stream activity events to the client
                if tool_name == "web_search":
                    yield make_sse_chunk(chat_id, created, model, {
                        "content": "",
                        "agentic_activity": {
                            "type": "search",
                            "query": tool_args.get("query", ""),
                            "round": round_num + 1,
                        },
                    })
                elif tool_name == "read_page":
                    yield make_sse_chunk(chat_id, created, model, {
                        "content": "",
                        "agentic_activity": {
                            "type": "read",
                            "url": tool_args.get("url", ""),
                            "round": round_num + 1,
                        },
                    })

                # Execute the tool
                result = execute_tool(tool_name, tool_args)

                # Stream result events
                if tool_name == "web_search":
                    try:
                        parsed = json.loads(result)
                        count = len(parsed) if isinstance(parsed, list) else 0
                    except Exception:
                        count = 0
                    yield make_sse_chunk(chat_id, created, model, {
                        "content": "",
                        "agentic_activity": {
                            "type": "search_results",
                            "count": count,
                            "round": round_num + 1,
                        },
                    })
                elif tool_name == "read_page":
                    yield make_sse_chunk(chat_id, created, model, {
                        "content": "",
                        "agentic_activity": {
                            "type": "read_done",
                            "chars": len(result),
                            "round": round_num + 1,
                        },
                    })

                messages.append({
                    "role": "tool",
                    "tool_call_id": tool_id,
                    "content": result,
                })

        # Stream the final response
        content = resp["choices"][0]["message"].get("content", "") if resp else ""
        thinking = resp["choices"][0]["message"].get("reasoning_content", "") if resp else ""

        if thinking:
            for i in range(0, len(thinking), 12):
                yield make_sse_chunk(chat_id, created, model, {"reasoning_content": thinking[i:i+12]})

        for i in range(0, len(content), 8):
            delta = {"content": content[i:i+8]}
            if i == 0:
                delta["role"] = "assistant"
            yield make_sse_chunk(chat_id, created, model, delta)

        # Final chunk with finish_reason
        final = {
            "id": chat_id,
            "object": "chat.completion.chunk",
            "created": created,
            "model": model,
            "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
        }
        yield f"data: {json.dumps(final)}\n\n"
        yield "data: [DONE]\n\n"

    return Response(
        stream_with_context(generate()),
        content_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ─────────────────────────────────────────────
# STREAM PROXY (for non-agentic requests)
# ─────────────────────────────────────────────
def proxy_request(url, method, headers, body):
    """Proxy a request to Ollama, handling both SSE and regular responses."""
    req = urllib.request.Request(url, data=body, headers=headers, method=method)

    try:
        resp = urllib.request.urlopen(req, timeout=300)
    except urllib.error.HTTPError as e:
        err_body = ""
        try:
            err_body = e.read().decode("utf-8", errors="replace")
        except Exception:
            pass
        return Response(err_body or e.reason, status=e.code, content_type="application/json")
    except urllib.error.URLError as e:
        return jsonify({"error": f"Unreachable: {e.reason}"}), 502

    content_type = resp.headers.get("Content-Type", "application/octet-stream")

    # SSE stream — read in background thread, yield from queue
    if "text/event-stream" in content_type:
        data_queue = queue.Queue()
        done_event = threading.Event()
        errors = []

        def reader():
            try:
                while True:
                    chunk = resp.read(4096)
                    if not chunk:
                        break
                    data_queue.put(chunk)
            except Exception as e:
                errors.append(str(e))
            finally:
                try:
                    resp.close()
                except Exception:
                    pass
                done_event.set()

        threading.Thread(target=reader, daemon=True).start()

        def keepalive_generator():
            last = time.time()
            while not done_event.is_set() or not data_queue.empty():
                try:
                    yield data_queue.get(timeout=1)
                    last = time.time()
                except queue.Empty:
                    if time.time() - last > 15:
                        yield b": keepalive\n\n"
                        last = time.time()
            if errors:
                yield f"data: {{'error': '{errors[0]}'}}\n\n".encode()

        return Response(
            stream_with_context(keepalive_generator()),
            content_type=content_type,
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    # Regular response
    def regular_generator():
        try:
            while True:
                chunk = resp.read(4096)
                if not chunk:
                    break
                yield chunk
        except Exception:
            pass
        finally:
            try:
                resp.close()
            except Exception:
                pass

    return Response(stream_with_context(regular_generator()), content_type=content_type)


# ─────────────────────────────────────────────
# ROUTES
# ─────────────────────────────────────────────
@app.route("/")
def index():
    return jsonify({"name": "NebChat", "v": "5.2", "engine": "Playwright"})


@app.route("/v1/models", methods=["GET"])
def list_models():
    try:
        models = req_lib.get(f"{OLLAMA_URL}/api/tags", timeout=5).json().get("models", [])
        return jsonify({
            "object": "list",
            "data": [
                {"id": m["name"], "object": "model", "owned_by": "ollama"}
                for m in models
            ],
        })
    except Exception:
        return jsonify({"object": "list", "data": []})


@app.route("/v1/chat/completions", methods=["POST"])
def chat_completions():
    body = request.get_json(force=True)
    stream = body.get("stream", False)
    messages = body.get("messages", [])

    # Detect agentic requests
    has_agentic_prompt = any(
        m.get("role") == "system" and (
            "search" in m.get("content", "").lower()
            or "agentic" in m.get("content", "").lower()
        )
        for m in messages
    )

    auto_trigger_keywords = [
        "search", "look up", "find", "current", "latest",
        "price", "news", "weather", "stock", "today",
        "recent", "score", "who", "when", "where",
        "how much", "how many",
    ]
    last_msg = str(messages[-1].get("content", "")).lower() if messages else ""
    auto_agentic = any(kw in last_msg for kw in auto_trigger_keywords)

    if has_agentic_prompt or auto_agentic:
        return handle_agentic(body, stream)

    # Non-agentic: just proxy to Ollama
    if stream:
        qs = request.query_string.decode("utf-8")
        target = f"{OLLAMA_URL}/v1/chat/completions" + (f"?{qs}" if qs else "")
        headers = {k: v for k, v in request.headers if k.lower() != "host"}
        return proxy_request(target, "POST", headers, request.get_data())

    try:
        return jsonify(call_ollama(body))
    except Exception as e:
        return jsonify({"error": str(e)}), 502


@app.route("/v1/<path:path>", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
def proxy_v1(path):
    qs = request.query_string.decode("utf-8")
    headers = {k: v for k, v in request.headers if k.lower() != "host"}
    headers["Content-Type"] = "application/json"
    target = f"{OLLAMA_URL}/v1/{path}" + (f"?{qs}" if qs else "")
    return proxy_request(target, request.method, headers, request.get_data())


@app.route("/api/<path:path>", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
def proxy_api(path):
    qs = request.query_string.decode("utf-8")
    headers = {k: v for k, v in request.headers if k.lower() != "host"}
    headers["Content-Type"] = "application/json"
    target = f"{OLLAMA_URL}/api/{path}" + (f"?{qs}" if qs else "")
    return proxy_request(target, request.method, headers, request.get_data())


@app.route("/search", methods=["GET"])
def search_endpoint():
    q = request.args.get("q", "")
    if not q:
        return jsonify({"error": "Missing ?q="}), 400
    return jsonify({"query": q, "results": json.loads(search_web(q))})


@app.route("/crawl", methods=["POST"])
def crawl_endpoint():
    url = request.get_json(force=True).get("url", "")
    if not url:
        return jsonify({"error": "Missing url"}), 400
    return jsonify({"url": url, "content": read_page(url)})


@app.route("/health", methods=["GET"])
def health():
    ollama_ok = False
    try:
        ollama_ok = req_lib.get(f"{OLLAMA_URL}/api/tags", timeout=3).ok
    except Exception:
        pass
    playwright_ok = get_browser() is not None
    return jsonify({
        "status": "ok" if ollama_ok else "degraded",
        "ollama": ollama_ok,
        "playwright": playwright_ok,
    })


@app.errorhandler(404)
@app.errorhandler(500)
def handle_error(e):
    return jsonify({"error": str(e)}), getattr(e, "code", 500)


# ─────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────
def start_bridge():
    """Start ngrok tunnel and Flask server."""
    from pyngrok import ngrok

    ngrok.set_auth_token(NGROK_TOKEN)
    public_url = ngrok.connect(BRIDGE_PORT, bind_tls=True).public_url

    print(f"\n{'=' * 60}")
    print(f"🚀 NebChat is LIVE!")
    print(f"📡 {public_url}")
    print(f"{'=' * 60}\n")

    with open("/content/nebchat_url.txt", "w") as f:
        f.write(public_url)

    app.run(host="0.0.0.0", port=BRIDGE_PORT, threaded=True)


def monitor(interval=120):
    """Periodic health check."""
    while True:
        time.sleep(interval)
        try:
            status = req_lib.get(f"http://127.0.0.1:{BRIDGE_PORT}/health", timeout=5).json()
            print(f"[MON] {status}", flush=True)
        except Exception:
            print("[MON] Server down!", flush=True)


if __name__ == "__main__":
    # Clean up, start services
    cleanup_old_processes()
    start_ollama()
    ensure_models()
    warmup_models()

    # Step 3: Start monitoring + bridge
    threading.Thread(target=monitor, daemon=True).start()
    start_bridge()
