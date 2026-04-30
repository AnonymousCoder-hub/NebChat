#!/usr/bin/env python3
"""
NebChat v6.0 — Ollama + Playwright + Flask Bridge + ngrok
Playwright ONLY for search & content. Thread-safe.
Paste this ENTIRE script in a single Colab cell and run.
"""

import os
import sys
import subprocess

# ─────────────────────────────────────────────
# STEP 1: Install Python packages FIRST
# ─────────────────────────────────────────────
def install_deps():
    """Install Python packages needed before we import them."""
    print("📦 Installing Python packages...")
    pip_pkgs = ["flask", "flask-cors", "pyngrok", "requests", "playwright"]
    for pkg in pip_pkgs:
        mod_name = pkg.replace("-", "_")
        try:
            __import__(mod_name)
            print(f"  ✅ {pkg}")
        except ImportError:
            print(f"  ⬇️ {pkg}...")
            subprocess.run([sys.executable, "-m", "pip", "install", "-q", pkg], check=True)
    print("✅ Python packages ready!\n")


# Run install at module level before other imports
install_deps()

# ─────────────────────────────────────────────
# STEP 2: Safe imports
# ─────────────────────────────────────────────
import json
import asyncio
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

# Chromium launch flags that actually work on Colab containers
CHROMIUM_ARGS = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--disable-software-rasterizer",
    "--disable-extensions",
    "--remote-debugging-port=9222",
]


# ─────────────────────────────────────────────
# OLLAMA MANAGEMENT
# ─────────────────────────────────────────────
def install_system_deps():
    """Install system-level deps."""
    if not os.path.exists("/usr/bin/zstd"):
        print("  ⬇️ zstd...")
        os.system("apt-get update -yqq && apt-get install -yqq zstd")
    else:
        print("  ✅ zstd")

    if not os.path.exists("/usr/local/bin/ollama"):
        print("  ⬇️ Ollama...")
        os.system("curl -fsSL https://ollama.com/install.sh | sh")
        os.environ["PATH"] += ":/usr/local/bin"
    else:
        print("  ✅ Ollama")


def cleanup_old_processes():
    """Kill leftover processes."""
    print("🧹 Cleaning up...")
    for proc in ["ollama", "ngrok", "nebchat"]:
        os.system(f"pkill -9 -f {proc} 2>/dev/null")
    for port in [OLLAMA_PORT, BRIDGE_PORT]:
        os.system(f"fuser -k {port}/tcp 2>/dev/null")
    time.sleep(2)


def start_ollama():
    """Start Ollama server and wait for ready."""
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
            print("✅ Ollama running!\n")
            return
        except Exception:
            time.sleep(1)
    raise RuntimeError("❌ Ollama failed to start")


def ensure_models():
    """Pull required models if missing."""
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
            print(f"  ⬇️ {model}...")
            subprocess.run(["ollama", "pull", model], check=True)
        else:
            print(f"  ✅ {model}")


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
    print("✅ Models warm!\n")


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
# PLAYWRIGHT — Thread-safe async browser
# ─────────────────────────────────────────────
_pw_loop = None
_pw_browser = None
_pw_playwright = None  # keep reference alive
_pw_lock = threading.Lock()


def init_playwright():
    """Install Chromium + launch browser. Called during startup."""
    global _pw_loop, _pw_browser, _pw_playwright

    # Step 1: Install Chromium binary
    print("  ⬇️ Installing Chromium...")
    r = subprocess.run(
        [sys.executable, "-m", "playwright", "install", "chromium"],
        capture_output=True, text=True, timeout=300,
    )
    if r.returncode != 0:
        print(f"  ⚠️ Chromium install issue: {r.stderr[:300]}")
    else:
        print("  ✅ Chromium installed")

    # Step 2: Install system deps for Chromium
    print("  ⬇️ System deps for Chromium (this takes a few minutes on first run)...")
    r = subprocess.run(
        [sys.executable, "-m", "playwright", "install-deps", "chromium"],
        capture_output=True, text=True, timeout=600,
    )
    if r.returncode != 0:
        print(f"  ⚠️ Deps issue: {r.stderr[:300]}")
    else:
        print("  ✅ System deps installed")

    # Step 3: Launch browser in a dedicated thread with its own asyncio loop
    print("  🌐 Launching browser...")
    ready = threading.Event()
    error_holder = [None]

    def _run_loop():
        global _pw_loop, _pw_browser, _pw_playwright

        async def _launch():
            global _pw_browser, _pw_playwright
            from playwright.async_api import async_playwright

            _pw_playwright = await async_playwright().start()
            _pw_browser = await _pw_playwright.chromium.launch(
                headless=True,
                args=CHROMIUM_ARGS,
            )
            ready.set()
            # Keep loop alive
            while True:
                await asyncio.sleep(3600)

        _pw_loop = asyncio.new_event_loop()
        asyncio.set_event_loop(_pw_loop)
        try:
            _pw_loop.run_until_complete(_launch())
        except Exception as e:
            error_holder[0] = str(e)
            ready.set()

    t = threading.Thread(target=_run_loop, daemon=True)
    t.start()
    ready.wait(timeout=30)

    if _pw_browser is None:
        err = error_holder[0] or "timeout"
        print(f"  ❌ Browser launch failed: {err}")
        return False

    # Step 4: Quick test — open a page and close it
    print("  🧪 Testing browser...", flush=True)
    try:
        future = asyncio.run_coroutine_threadsafe(_test_browser(), _pw_loop)
        future.result(timeout=20)
        print("  ✅ Browser test passed!\n")
        return True
    except Exception as e:
        print(f"  ❌ Browser test failed: {e}")
        print("  🔄 Retrying with different settings...")
        return _retry_launch()


async def _test_browser():
    """Open a simple page to verify the browser works."""
    ctx = await _pw_browser.new_context(
        user_agent=USER_AGENT,
        viewport={"width": 1280, "height": 720},
    )
    page = await ctx.new_page()
    await page.goto("https://www.example.com", timeout=15000, wait_until="domcontentloaded")
    title = await page.title()
    await ctx.close()
    print(f"     Page title: {title}")


def _retry_launch():
    """Retry with simpler args if default launch fails."""
    global _pw_loop, _pw_browser, _pw_playwright

    # Close old browser if any
    if _pw_browser:
        try:
            future = asyncio.run_coroutine_threadsafe(_pw_browser.close(), _pw_loop)
            future.result(timeout=5)
        except Exception:
            pass

    ready = threading.Event()
    error_holder = [None]

    # Fallback: minimal args
    fallback_args = ["--no-sandbox", "--disable-dev-shm-usage"]

    def _run_fallback():
        global _pw_loop, _pw_browser, _pw_playwright

        async def _launch():
            global _pw_browser, _pw_playwright
            from playwright.async_api import async_playwright

            _pw_playwright = await async_playwright().start()
            _pw_browser = await _pw_playwright.chromium.launch(
                headless=True,
                args=fallback_args,
            )
            ready.set()
            while True:
                await asyncio.sleep(3600)

        # Reuse existing loop or create new one
        if _pw_loop is None or _pw_loop.is_closed():
            _pw_loop = asyncio.new_event_loop()
            asyncio.set_event_loop(_pw_loop)
        try:
            _pw_loop.run_until_complete(_launch())
        except Exception as e:
            error_holder[0] = str(e)
            ready.set()

    t = threading.Thread(target=_run_fallback, daemon=True)
    t.start()
    ready.wait(timeout=30)

    if _pw_browser is None:
        print(f"  ❌ Retry also failed: {error_holder[0]}")
        return False

    # Test again
    try:
        future = asyncio.run_coroutine_threadsafe(_test_browser(), _pw_loop)
        future.result(timeout=20)
        print("  ✅ Browser works with fallback settings!\n")
        return True
    except Exception as e:
        print(f"  ❌ Browser test still failing: {e}")
        return False


def _pw_submit(coro):
    """Submit an async coroutine to the PW event loop, wait for result."""
    if _pw_loop is None or _pw_browser is None:
        raise RuntimeError("Playwright not initialized")
    future = asyncio.run_coroutine_threadsafe(coro, _pw_loop)
    return future.result(timeout=120)


# ── Async search & read ──

async def _async_search(query, max_results=10):
    """Search Bing via Playwright."""
    ctx = None
    try:
        ctx = await _pw_browser.new_context(
            user_agent=USER_AGENT,
            viewport={"width": 1280, "height": 720},
            locale="en-US",
        )
        page = await ctx.new_page()
        url = (
            f"https://www.bing.com/search?q={urllib.parse.quote(query)}"
            f"&count={max_results}&setlang=en&cc=US"
        )
        await page.goto(url, timeout=15000, wait_until="domcontentloaded")
        await page.wait_for_timeout(2000)

        # Captcha check
        is_captcha = await page.evaluate(
            "() => {"
            "  const t = document.body.innerText || '';"
            "  return t.includes('captcha') || t.includes('verify you are human');"
            "}"
        )
        if is_captcha:
            await ctx.close()
            return json.dumps({"error": "Captcha detected"})

        # Extract results
        results = await page.evaluate(
            "(n) => ["
            "  ...document.querySelectorAll('#b_results li.b_algo')"
            "].slice(0, n).map(li => ({"
            "  title: li.querySelector('h2 a')?.textContent?.trim() || '',"
            "  url: li.querySelector('h2 a')?.href || '',"
            "  snippet: li.querySelector('.b_caption p, .b_lineclamp2, p')?.textContent?.trim() || ''"
            "}))",
            max_results,
        )
        await ctx.close()
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
            await ctx.close()
        except Exception:
            pass

    return json.dumps({"error": "Search failed"})


async def _async_read_page(url, max_chars=8000):
    """Read any webpage via Playwright."""
    ctx = None
    try:
        ctx = await _pw_browser.new_context(
            user_agent=USER_AGENT,
            viewport={"width": 1280, "height": 720},
        )
        page = await ctx.new_page()
        await page.goto(url, timeout=20000, wait_until="domcontentloaded")
        await page.wait_for_timeout(2000)

        text = await page.evaluate(
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
        await ctx.close()
        ctx = None

        if text and len(text.strip()) > 50:
            print(f"[READ] {len(text)} chars from {url[:60]}", flush=True)
            return text

    except Exception as e:
        print(f"[READ] Error: {e}", flush=True)

    if ctx:
        try:
            await ctx.close()
        except Exception:
            pass

    return "Failed to read page."


# ── Public sync wrappers ──

def search_web(query, max_results=10):
    """Search Bing. Thread-safe wrapper."""
    try:
        if _pw_browser is None:
            return json.dumps({"error": "Browser not available"})
        return _pw_submit(_async_search(query, max_results))
    except Exception as e:
        print(f"[SEARCH] Error: {e}", flush=True)
        return json.dumps({"error": f"Search error: {e}"})


def read_page(url, max_chars=8000):
    """Read any webpage. Thread-safe wrapper."""
    try:
        if _pw_browser is None:
            return "Browser not available"
        return _pw_submit(_async_read_page(url, max_chars))
    except Exception as e:
        print(f"[READ] Error: {e}", flush=True)
        return f"Read error: {e}"


def execute_tool(name, args):
    """Dispatch a tool call."""
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

                result = execute_tool(tool_name, tool_args)

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
# STREAM PROXY
# ─────────────────────────────────────────────
def proxy_request(url, method, headers, body):
    """Proxy a request to Ollama."""
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
    return jsonify({"name": "NebChat", "v": "6.0", "engine": "Playwright"})


@app.route("/v1/models", methods=["GET"])
def list_models():
    try:
        models = req_lib.get(f"{OLLAMA_URL}/api/tags", timeout=5).json().get("models", [])
        return jsonify({
            "object": "list",
            "data": [{"id": m["name"], "object": "model", "owned_by": "ollama"} for m in models],
        })
    except Exception:
        return jsonify({"object": "list", "data": []})


@app.route("/v1/chat/completions", methods=["POST"])
def chat_completions():
    body = request.get_json(force=True)
    stream = body.get("stream", False)
    messages = body.get("messages", [])

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
    return jsonify({
        "status": "ok" if ollama_ok else "degraded",
        "ollama": ollama_ok,
        "playwright": _pw_browser is not None,
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
    # Step 1: System deps
    print("📦 System dependencies...")
    install_system_deps()

    # Step 2: Clean up + start Ollama
    cleanup_old_processes()
    start_ollama()
    ensure_models()
    warmup_models()

    # Step 3: Initialize Playwright DURING SETUP (not lazy)
    print("🌐 Setting up Playwright...")
    pw_ok = init_playwright()
    if not pw_ok:
        print("⚠️  Playwright failed — search won't work, but chat will.\n")

    # Step 4: Start server
    threading.Thread(target=monitor, daemon=True).start()
    start_bridge()
