#!/usr/bin/env python3
"""
NebChat v6.1 — Ollama + Playwright + Flask Bridge + ngrok
Google search (primary) + Bing (fallback). 32K context.
Paste this ENTIRE script in a single Colab cell and run.
"""

import os
import sys
import subprocess

# ─────────────────────────────────────────────
# STEP 1: Install Python packages FIRST
# ─────────────────────────────────────────────
def install_deps():
    print("📦 Installing Python packages...")
    for pkg in ["flask", "flask-cors", "pyngrok", "requests", "playwright"]:
        mod_name = pkg.replace("-", "_")
        try:
            __import__(mod_name)
            print(f"  ✅ {pkg}")
        except ImportError:
            print(f"  ⬇️ {pkg}...")
            subprocess.run([sys.executable, "-m", "pip", "install", "-q", pkg], check=True)
    print("✅ Python packages ready!\n")

install_deps()

# ─────────────────────────────────────────────
# STEP 2: Imports
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
    "OLLAMA_CONTEXT_LENGTH": "32768",
}

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
    print("🧹 Cleaning up...")
    for proc in ["ollama", "ngrok", "nebchat"]:
        os.system(f"pkill -9 -f {proc} 2>/dev/null")
    for port in [OLLAMA_PORT, BRIDGE_PORT]:
        os.system(f"fuser -k {port}/tcp 2>/dev/null")
    time.sleep(2)


def start_ollama():
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
_pw_playwright = None
_pw_lock = threading.Lock()


def init_playwright():
    """Install Chromium + launch browser. Called during startup."""
    global _pw_loop, _pw_browser, _pw_playwright

    print("  ⬇️ Installing Chromium...")
    r = subprocess.run(
        [sys.executable, "-m", "playwright", "install", "chromium"],
        capture_output=True, text=True, timeout=300,
    )
    if r.returncode != 0:
        print(f"  ⚠️ Chromium install issue: {r.stderr[:300]}")
    else:
        print("  ✅ Chromium installed")

    print("  ⬇️ System deps for Chromium (few minutes on first run)...")
    r = subprocess.run(
        [sys.executable, "-m", "playwright", "install-deps", "chromium"],
        capture_output=True, text=True, timeout=600,
    )
    if r.returncode != 0:
        print(f"  ⚠️ Deps issue: {r.stderr[:300]}")
    else:
        print("  ✅ System deps installed")

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
        # Retry with minimal args
        return _retry_launch()

    print("  🧪 Testing browser...", flush=True)
    try:
        future = asyncio.run_coroutine_threadsafe(_test_browser(), _pw_loop)
        future.result(timeout=20)
        print("  ✅ Browser test passed!\n")
        return True
    except Exception as e:
        print(f"  ❌ Browser test failed: {e}")
        return _retry_launch()


async def _test_browser():
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
    global _pw_loop, _pw_browser, _pw_playwright

    if _pw_browser:
        try:
            future = asyncio.run_coroutine_threadsafe(_pw_browser.close(), _pw_loop)
            future.result(timeout=5)
        except Exception:
            pass

    ready = threading.Event()
    error_holder = [None]
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

    try:
        future = asyncio.run_coroutine_threadsafe(_test_browser(), _pw_loop)
        future.result(timeout=20)
        print("  ✅ Browser works with fallback settings!\n")
        return True
    except Exception as e:
        print(f"  ❌ Browser test still failing: {e}")
        return False


def _pw_submit(coro):
    if _pw_loop is None or _pw_browser is None:
        raise RuntimeError("Playwright not initialized")
    future = asyncio.run_coroutine_threadsafe(coro, _pw_loop)
    return future.result(timeout=120)


# ── Google Search (primary) ──

async def _async_search_google(query, max_results=8):
    """Search Google. Returns English results."""
    ctx = None
    try:
        ctx = await _pw_browser.new_context(
            user_agent=USER_AGENT,
            viewport={"width": 1280, "height": 720},
            locale="en-US",
        )
        page = await ctx.new_page()
        url = f"https://www.google.com/search?q={urllib.parse.quote(query)}&num={max_results}&hl=en&gl=us"
        await page.goto(url, timeout=12000, wait_until="domcontentloaded")
        await page.wait_for_timeout(1500)

        # Check for captcha
        page_text = await page.evaluate("() => document.body.innerText || ''")
        if "sorry" in page_text.lower() and "captcha" in page_text.lower():
            await ctx.close()
            return None  # fallback to Bing

        # Extract Google results
        results = await page.evaluate(
            "() => ["
            "  ...document.querySelectorAll('div.g, div[data-ved]')"
            "].filter(el => el.querySelector('h3') && el.querySelector('a')).slice(0, 8).map(el => ({"
            "  title: el.querySelector('h3')?.textContent?.trim() || '',"
            "  url: el.querySelector('a')?.href || '',"
            "  snippet: (el.querySelector('div.VwiC3b, span.aCOpRe, div[style]')?.textContent || '').trim()"
            "}))"
        )
        await ctx.close()
        ctx = None

        # Filter out empty/ad results
        results = [r for r in (results or [])
                   if r.get('title') and r.get('url') and 'google.com' not in r.get('url', '')]

        if results:
            for r in results:
                r["snippet"] = (r.get("snippet", "") or "")[:500]
            print(f"[SEARCH-G] {len(results)} results for '{query[:40]}'", flush=True)
            return json.dumps(results)

    except Exception as e:
        print(f"[SEARCH-G] Error: {e}", flush=True)

    if ctx:
        try:
            await ctx.close()
        except Exception:
            pass

    return None  # signal to try Bing


# ── Bing Search (fallback) ──

async def _async_search_bing(query, max_results=8):
    """Search Bing. Fallback when Google fails."""
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
            f"&count={max_results}&setlang=en&cc=US&mkt=en-US"
        )
        await page.goto(url, timeout=12000, wait_until="domcontentloaded")
        await page.wait_for_timeout(1500)

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
            print(f"[SEARCH-B] {len(results)} results for '{query[:40]}'", flush=True)
            return json.dumps(results)

    except Exception as e:
        print(f"[SEARCH-B] Error: {e}", flush=True)

    if ctx:
        try:
            await ctx.close()
        except Exception:
            pass

    return json.dumps({"error": "Search failed"})


# ── Combined search: Google → Bing fallback ──

async def _async_search(query, max_results=8):
    """Search Google first, fallback to Bing."""
    result = await _async_search_google(query, max_results)
    if result:
        return result
    print("[SEARCH] Google failed, trying Bing...", flush=True)
    return await _async_search_bing(query, max_results)


# ── Read page ──

async def _async_read_page(url, max_chars=12000):
    """Read any webpage via Playwright."""
    ctx = None
    try:
        ctx = await _pw_browser.new_context(
            user_agent=USER_AGENT,
            viewport={"width": 1280, "height": 720},
        )
        page = await ctx.new_page()
        await page.goto(url, timeout=20000, wait_until="domcontentloaded")
        await page.wait_for_timeout(1500)

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

def search_web(query, max_results=8):
    try:
        if _pw_browser is None:
            return json.dumps({"error": "Browser not available"})
        return _pw_submit(_async_search(query, max_results))
    except Exception as e:
        print(f"[SEARCH] Error: {e}", flush=True)
        return json.dumps({"error": f"Search error: {e}"})


def read_page(url, max_chars=12000):
    try:
        if _pw_browser is None:
            return "Browser not available"
        return _pw_submit(_async_read_page(url, max_chars))
    except Exception as e:
        print(f"[READ] Error: {e}", flush=True)
        return f"Read error: {e}"


def execute_tool(name, args):
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
            "description": "Search the web using Google (primary) or Bing (fallback). Returns list of results with title, url, snippet.",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string", "description": "Search query in English"}},
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_page",
            "description": "Read the full text content of any webpage. Use this AFTER searching to get detailed information from the best URLs. Returns up to 12000 characters of clean text.",
            "parameters": {
                "type": "object",
                "properties": {"url": {"type": "string", "description": "Full URL to read"}},
                "required": ["url"],
            },
        },
    },
]

SYSTEM_PROMPT = """You are a research AI with TWO tools: web_search and read_page.

CRITICAL RULES - YOU MUST FOLLOW THESE:

1) ALWAYS web_search FIRST for any question about current events, prices, news, or data.

2) AFTER EVERY SEARCH, you MUST use read_page on the top 2-3 URLs from the results.
   Search results only give titles and short snippets - you need to READ the actual pages to get useful data.
   NEVER answer based on just search snippets. ALWAYS read pages for details.

3) WORKFLOW FOR EVERY QUERY:
   Step 1: web_search for relevant information
   Step 2: read_page on the best 2-3 URLs from results
   Step 3: If you need more info, web_search again with different keywords
   Step 4: read_page on new URLs
   Step 5: Only NOW answer with the detailed information you gathered

4) Use English search queries. If results are not in English, add "in English" to your query.

5) Never say you cannot browse or search - you CAN and MUST use both tools.

6) Cite your sources with URLs.

7) Be concise in your final answer. Don't repeat the search process, just give the answer."""


def call_ollama(body):
    """Non-streaming call to Ollama."""
    body["stream"] = False
    req = urllib.request.Request(
        f"{OLLAMA_URL}/v1/chat/completions",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    resp = urllib.request.urlopen(req, timeout=180)
    return json.loads(resp.read())


def make_sse_chunk(chat_id, created, model, delta):
    chunk = {
        "id": chat_id,
        "object": "chat.completion.chunk",
        "created": created,
        "model": model,
        "choices": [{"index": 0, "delta": delta, "finish_reason": None}],
    }
    return f"data: {json.dumps(chunk)}\n\n"


def handle_agentic(body, stream):
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
    return jsonify({"name": "NebChat", "v": "6.1", "engine": "Playwright"})


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
    while True:
        time.sleep(interval)
        try:
            status = req_lib.get(f"http://127.0.0.1:{BRIDGE_PORT}/health", timeout=5).json()
            print(f"[MON] {status}", flush=True)
        except Exception:
            print("[MON] Server down!", flush=True)


if __name__ == "__main__":
    print("📦 System dependencies...")
    install_system_deps()

    cleanup_old_processes()
    start_ollama()
    ensure_models()
    warmup_models()

    print("🌐 Setting up Playwright...")
    pw_ok = init_playwright()
    if not pw_ok:
        print("⚠️  Playwright failed — search won't work, but chat will.\n")

    threading.Thread(target=monitor, daemon=True).start()
    start_bridge()
