#!/usr/bin/env python3
# ============================================================
#  NebChat Colab Setup — v2.0
#  Ollama + Jina Search + DuckDuckGo + Crawl4AI + Flask Bridge + ngrok
#  Run this ENTIRE script in a single Colab cell.
# ============================================================

import os, sys, time, json, subprocess, threading, shutil

# -------------------- CONFIG --------------------
NGROK_TOKEN = "YOUR_NGROK_AUTH_TOKEN_HERE"  # <-- Replace with your ngrok token!
PORT_OLLAMA = 11434
PORT_CRAWL4AI = 8020
PORT_BRIDGE = 5000
MODELS = ["qwen3:8b"]

OLLAMA_ENV = {
    "OLLAMA_KEEP_ALIVE": "-1",
    "OLLAMA_NUM_PARALLEL": "4",
    "OLLAMA_MAX_LOADED_MODELS": "3",
    "OLLAMA_GPU_LAYERS": "999",
    "OLLAMA_FLASH_ATTENTION": "1",
    "OLLAMA_KV_CACHE_TYPE": "q8_0",
    "OLLAMA_CONTEXT_LENGTH": "8192",
}

# -------------------- SETUP --------------------
def setup_system():
    print("📦 Setting up system dependencies...")
    if shutil.which("zstd") is None:
        os.system("apt-get update -y && apt-get install -y zstd")
    try:
        import flask, flask_cors, pyngrok
    except:
        os.system("pip install -q flask flask-cors pyngrok")
    try:
        from duckduckgo_search import DDGS
    except:
        print("🔍 Installing DuckDuckGo Search (fallback)...")
        os.system("pip install -q duckduckgo-search")
    if shutil.which("ollama") is None:
        print("⬇️ Installing Ollama...")
        os.system("curl -fsSL https://ollama.com/install.sh | sh")
        os.environ["PATH"] += ":/usr/local/bin"
    print("✅ System ready")

# -------------------- CLEAN --------------------
def cleanup():
    print("🧹 Cleaning up old processes...")
    os.system("pkill -9 -f ollama 2>/dev/null || true")
    os.system("pkill -9 -f ngrok 2>/dev/null || true")
    os.system("pkill -9 -f crawl4ai 2>/dev/null || true")
    os.system("pkill -9 -f nebchat_bridge 2>/dev/null || true")
    os.system(f"fuser -k {PORT_OLLAMA}/tcp 2>/dev/null || true")
    os.system(f"fuser -k {PORT_BRIDGE}/tcp 2>/dev/null || true")
    os.system(f"fuser -k {PORT_CRAWL4AI}/tcp 2>/dev/null || true")
    time.sleep(2)

# -------------------- START OLLAMA --------------------
def start_ollama():
    env = os.environ.copy()
    env.update(OLLAMA_ENV)
    print("🚀 Starting Ollama...")
    log_file = open("/content/ollama.log", "w")
    subprocess.Popen(
        ["ollama", "serve"],
        stdout=subprocess.DEVNULL,
        stderr=log_file,
        env=env
    )
    import requests
    for _ in range(30):
        try:
            requests.get(f"http://127.0.0.1:{PORT_OLLAMA}/api/tags", timeout=2)
            print("✅ Ollama ready")
            return
        except:
            time.sleep(1)
    raise RuntimeError("❌ Ollama failed to start — check /content/ollama.log")

# -------------------- START CRAWL4AI --------------------
def start_crawl4ai():
    print("🕷️ Installing Crawl4AI...")
    os.system("pip install -q crawl4ai")

    crawl_script = '''
import asyncio
from crawl4ai import AsyncWebCrawler, CrawlerRunConfig, BrowserConfig
from aiohttp import web

async def handle_crawl(request):
    try:
        data = await request.json()
        url = data.get("url", "")
        if not url:
            return web.json_response({"error": "URL is required"}, status=400)
        browser_config = BrowserConfig(headless=True)
        run_config = CrawlerRunConfig(
            word_count_threshold=10,
            exclude_external_links=True,
            remove_overlay_elements=True,
            exclude_all_images=True,
            text_mode=True,
        )
        async with AsyncWebCrawler(config=browser_config) as crawler:
            result = await crawler.arun(url=url, config=run_config)
            return web.json_response({
                "url": url,
                "content": {
                    "markdown": result.markdown_v2.raw_markdown if hasattr(result, "markdown_v2") else result.markdown,
                },
                "success": result.success,
                "status_code": result.status_code,
            })
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)

async def handle_health(request):
    return web.json_response({"status": "ok"})

app = web.Application()
app.router.add_post("/crawl", handle_crawl)
app.router.add_post("/crawl_stream", handle_crawl)
app.router.add_get("/health", handle_health)

if __name__ == "__main__":
    web.run_app(app, host="0.0.0.0", port=8020)
'''
    with open("/content/crawl4ai_server.py", "w") as f:
        f.write(crawl_script)

    print("🕷️ Starting Crawl4AI server...")
    subprocess.Popen(
        ["python", "/content/crawl4ai_server.py"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL
    )
    import requests
    for _ in range(15):
        try:
            r = requests.get(f"http://127.0.0.1:{PORT_CRAWL4AI}/health", timeout=2)
            if r.ok:
                print("✅ Crawl4AI ready")
                return
        except:
            time.sleep(1)
    print("⚠️ Crawl4AI may need more time, continuing anyway...")

# -------------------- MODELS --------------------
def ensure_models():
    import requests
    try:
        res = requests.get(f"http://127.0.0.1:{PORT_OLLAMA}/api/tags").json()
        existing = [m["name"] for m in res.get("models", [])]
    except:
        existing = []
    for model in MODELS:
        if not any(model in m for m in existing):
            print(f"⬇️ Pulling {model}...")
            subprocess.run(["ollama", "pull", model], check=True)
        else:
            print(f"✅ {model} ready")

# -------------------- WARMUP --------------------
def warmup_all():
    import requests
    print("🔥 Warming up models...")
    for model in MODELS:
        print(f"⚡ Warming {model}...")
        try:
            requests.post(
                f"http://127.0.0.1:{PORT_OLLAMA}/api/generate",
                json={"model": model, "prompt": "hi", "stream": False},
                timeout=240
            )
        except:
            pass
    print("✅ Warmed up successfully!")

# -------------------- SEARCH FUNCTIONS --------------------
def jina_search(query, max_results=10):
    import requests
    try:
        resp = requests.get(
            f"https://s.jina.ai/{query}",
            headers={"Accept": "application/json"},
            params={"num": max_results},
            timeout=15
        )
        if not resp.ok:
            return None
        data = resp.json()
        results = []
        for item in data.get("data", []):
            results.append({
                "title": item.get("title", ""),
                "url": item.get("url", ""),
                "content": item.get("content", "")[:3000],
                "description": item.get("description", ""),
            })
        return results
    except Exception as e:
        print(f"⚠️ Jina search error: {e}")
        return None

def duckduckgo_search(query, max_results=10):
    try:
        from duckduckgo_search import DDGS
        results = []
        with DDGS() as ddgs:
            for r in ddgs.text(query, max_results=max_results):
                results.append({
                    "title": r.get("title", ""),
                    "url": r.get("href", ""),
                    "content": r.get("body", ""),
                })
            if len(results) < max_results:
                try:
                    for r in ddgs.news(query, max_results=min(5, max_results - len(results))):
                        results.append({
                            "title": r.get("title", ""),
                            "url": r.get("url", r.get("href", "")),
                            "content": r.get("body", ""),
                        })
                except:
                    pass
        return results
    except Exception as e:
        print(f"⚠️ DuckDuckGo search error: {e}")
        return None

def jina_read_page(url):
    import requests
    try:
        resp = requests.get(
            f"https://r.jina.ai/{url}",
            headers={"Accept": "text/plain"},
            timeout=15
        )
        if resp.ok:
            return resp.text[:5000]
        return None
    except:
        return None

# -------------------- FLASK BRIDGE (written to file) --------------------
def write_bridge_file():
    # Write the Flask bridge as a separate Python file to avoid
    # triple-quote escaping issues in Colab cells
    bridge_path = "/content/nebchat_bridge.py"
    with open(bridge_path, "w") as f:
        f.write(BRIDGE_CODE)
    print(f"📝 Bridge script written to {bridge_path}")
    return bridge_path

BRIDGE_CODE = """#!/usr/bin/env python3
# NebChat Unified Bridge — Flask application

import os, sys, time, json, traceback, threading, queue
import urllib.request, urllib.error, urllib.parse
from datetime import datetime, timezone
from flask import Flask, Response, request, jsonify, stream_with_context
from flask_cors import CORS

PORT_OLLAMA = int(os.environ.get("PORT_OLLAMA", 11434))
PORT_CRAWL4AI = int(os.environ.get("PORT_CRAWL4AI", 8020))
OLLAMA_BASE = f"http://localhost:{PORT_OLLAMA}"
CRAWL4AI_BASE = f"http://localhost:{PORT_CRAWL4AI}"
JINA_SEARCH_URL = "https://s.jina.ai/"
JINA_READER_URL = "https://r.jina.ai/"
KEEPALIVE_INTERVAL = 15

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

_req_counter = 0
_req_lock = threading.Lock()

def _next_id():
    global _req_counter
    with _req_lock:
        _req_counter += 1
        return _req_counter

@app.before_request
def _log_req():
    rid = _next_id()
    ts = datetime.now(timezone.utc).strftime("%H:%M:%S")
    print(f"[{ts}] #{rid:05d} {request.method} {request.path}", flush=True)

def _proxy_url(base, path):
    qs = request.query_string.decode("utf-8")
    url = f"{base}/{path}"
    if qs:
        url += f"?{qs}"
    return url

def _stream_response(upstream_url, method, headers, body):
    req = urllib.request.Request(upstream_url, data=body, headers=headers, method=method)
    try:
        resp = urllib.request.urlopen(req, timeout=300)
    except urllib.error.HTTPError as exc:
        err_body = ""
        try:
            err_body = exc.read().decode("utf-8", errors="replace")
        except:
            pass
        return Response(err_body or exc.reason, status=exc.code, content_type="application/json")
    except urllib.error.URLError as exc:
        return jsonify({"error": f"Upstream unreachable: {exc.reason}"}), 502

    content_type = resp.headers.get("Content-Type", "application/octet-stream")
    is_sse = "text/event-stream" in content_type

    if is_sse:
        data_q = queue.Queue()
        done = threading.Event()
        errors = []

        def reader():
            try:
                while True:
                    chunk = resp.read(4096)
                    if not chunk:
                        break
                    data_q.put(chunk)
            except Exception as exc:
                errors.append(str(exc))
            finally:
                try:
                    resp.close()
                except:
                    pass
                done.set()

        threading.Thread(target=reader, daemon=True).start()

        def sse_keepalive():
            last_ka = time.time()
            while not done.is_set() or not data_q.empty():
                try:
                    chunk = data_q.get(timeout=1)
                    yield chunk
                    last_ka = time.time()
                except queue.Empty:
                    if time.time() - last_ka > KEEPALIVE_INTERVAL:
                        yield b": keepalive\\n\\n"
                        last_ka = time.time()
            if errors:
                yield f"data: {{'error': '{errors[0]}'}}\\n\\n".encode()

        return Response(
            stream_with_context(sse_keepalive()),
            content_type=content_type,
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    def generate():
        try:
            while True:
                chunk = resp.read(4096)
                if not chunk:
                    break
                yield chunk
        except:
            pass
        finally:
            try:
                resp.close()
            except:
                pass

    return Response(stream_with_context(generate()), content_type=content_type)

@app.route("/")
def index():
    return jsonify({
        "service": "NebChat Unified Bridge",
        "version": "2.0",
        "endpoints": {
            "GET /": "Status page",
            "GET /v1/models": "List Ollama models",
            "POST /v1/chat/completions": "OpenAI-compatible chat (streaming)",
            "* /v1/<path>": "Proxy to Ollama /v1/*",
            "* /api/<path>": "Proxy to Ollama /api/*",
            "GET /search?q=...": "Search (Jina + DDG fallback)",
            "POST /crawl": "Read page (Crawl4AI + Jina Reader fallback)",
            "GET /health": "Health check",
        },
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })

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
    headers = {"Content-Type": request.content_type or "application/json"}
    return _stream_response(
        _proxy_url(OLLAMA_BASE, "v1/chat/completions"),
        method="POST", headers=headers, body=body,
    )

@app.route("/v1/<path:path>", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
def proxy_v1(path):
    body = request.get_data() if request.method in ("POST", "PUT", "PATCH") else None
    headers = {}
    if request.content_type:
        headers["Content-Type"] = request.content_type
    return _stream_response(
        _proxy_url(OLLAMA_BASE, f"v1/{path}"),
        method=request.method, headers=headers, body=body,
    )

@app.route("/api/<path:path>", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
def proxy_api(path):
    body = request.get_data() if request.method in ("POST", "PUT", "PATCH") else None
    headers = {}
    if request.content_type:
        headers["Content-Type"] = request.content_type
    return _stream_response(
        _proxy_url(OLLAMA_BASE, f"api/{path}"),
        method=request.method, headers=headers, body=body,
    )

@app.route("/search", methods=["GET"])
def search():
    query = request.args.get("q", "").strip()
    max_results = min(int(request.args.get("max_results", 10)), 20)
    if not query:
        return jsonify({"error": "Missing query parameter 'q'"}), 400

    # --- Jina AI Search ---
    try:
        jina_url = f"{JINA_SEARCH_URL}{urllib.parse.quote(query)}"
        jina_headers = {"Accept": "application/json", "X-Return-Format": "search", "X-No-Cache": "true"}
        jina_key = os.environ.get("JINA_API_KEY", "")
        if jina_key:
            jina_headers["Authorization"] = f"Bearer {jina_key}"
        req = urllib.request.Request(jina_url, headers=jina_headers, method="GET")
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read())
        results = []
        if isinstance(data, dict):
            for item in data.get("data", [])[:max_results]:
                results.append({
                    "title": item.get("title", ""),
                    "url": item.get("url", ""),
                    "description": item.get("description", item.get("snippet", "")),
                    "content": item.get("content", ""),
                })
        if results:
            return jsonify({"query": query, "source": "jina", "results": results})
    except Exception as exc:
        print(f"[SEARCH] Jina failed: {exc}", flush=True)

    # --- DuckDuckGo fallback ---
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
        return jsonify({"query": query, "source": "duckduckgo", "results": results})
    except Exception as exc:
        return jsonify({
            "query": query, "source": "none", "results": [],
            "error": f"Search failed: {exc}",
        }), 502

@app.route("/crawl", methods=["POST"])
def crawl():
    payload = request.get_json(silent=True) or {}
    url = payload.get("url", "").strip()
    if not url:
        return jsonify({"error": "Missing 'url' in request body"}), 400

    # --- Crawl4AI ---
    try:
        import requests as req_lib
        resp = req_lib.post(f"{CRAWL4AI_BASE}/crawl", json={"url": url}, timeout=60)
        if resp.ok:
            data = resp.json()
            content = ""
            if isinstance(data, dict):
                c = data.get("content", data.get("result", {}))
                if isinstance(c, dict):
                    content = c.get("markdown", c.get("raw_markdown", json.dumps(c)))
                elif isinstance(c, str):
                    content = c
            if data.get("success", False) or (content and len(content.strip()) > 50):
                return jsonify({"url": url, "source": "crawl4ai", "content": {"markdown": content}, "success": True, "status_code": 200})
    except Exception as exc:
        print(f"[CRAWL] Crawl4AI failed: {exc}", flush=True)

    # --- Jina Reader fallback ---
    try:
        jina_url = f"{JINA_READER_URL}{urllib.parse.quote(url, safe=':/?#[]@!$&()*+,;=')}"
        jina_headers = {"Accept": "text/markdown"}
        jina_key = os.environ.get("JINA_API_KEY", "")
        if jina_key:
            jina_headers["Authorization"] = f"Bearer {jina_key}"
        req = urllib.request.Request(jina_url, headers=jina_headers, method="GET")
        with urllib.request.urlopen(req, timeout=45) as resp:
            content = resp.read().decode("utf-8", errors="replace")
        if content and len(content.strip()) > 20:
            return jsonify({"url": url, "source": "jina_reader", "content": {"markdown": content[:5000]}, "success": True, "status_code": 200})
    except Exception as exc:
        return jsonify({
            "url": url, "source": "none", "content": {"markdown": ""},
            "success": False, "error": f"Crawl failed: {exc}",
        }), 502

    return jsonify({
        "url": url, "source": "none", "content": {"markdown": ""},
        "success": False, "error": "Both Crawl4AI and Jina Reader returned empty",
    }), 502

@app.route("/health", methods=["GET"])
def health():
    services = {}
    try:
        req = urllib.request.Request(f"{OLLAMA_BASE}/api/tags", method="GET")
        with urllib.request.urlopen(req, timeout=5) as resp:
            tags = json.loads(resp.read())
        services["ollama"] = {"status": "ok", "models": [m.get("name", "") for m in tags.get("models", [])]}
    except:
        services["ollama"] = {"status": "offline"}
    try:
        req = urllib.request.Request(f"{CRAWL4AI_BASE}/health", method="GET")
        with urllib.request.urlopen(req, timeout=5) as resp:
            _ = resp.read()
        services["crawl4ai"] = {"status": "ok"}
    except:
        services["crawl4ai"] = {"status": "offline"}
    services["jina_search"] = {"status": "available"}
    return jsonify({"status": "ok", "services": services})

@app.errorhandler(404)
def not_found(e):
    return jsonify({"error": "Not found", "path": request.path}), 404

@app.errorhandler(500)
def server_error(e):
    return jsonify({"error": "Internal server error", "detail": str(e)}), 500

if __name__ == "__main__":
    print("=" * 60)
    print("  NebChat Unified Bridge")
    print(f"  Ollama:   {OLLAMA_BASE}")
    print(f"  Crawl4AI: {CRAWL4AI_BASE}")
    print("=" * 60)
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT_BRIDGE", 5000)), debug=False, threaded=True)
"""

# -------------------- START BRIDGE + TUNNEL --------------------
def start_bridge_and_tunnel():
    import requests
    from flask import Flask  # noqa — just to verify flask is importable

    bridge_path = write_bridge_file()

    env = os.environ.copy()
    env["PORT_OLLAMA"] = str(PORT_OLLAMA)
    env["PORT_CRAWL4AI"] = str(PORT_CRAWL4AI)
    env["PORT_BRIDGE"] = str(PORT_BRIDGE)

    subprocess.Popen(
        [sys.executable, bridge_path],
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )

    for _ in range(15):
        try:
            r = requests.get(f"http://127.0.0.1:{PORT_BRIDGE}/health", timeout=3)
            if r.ok:
                break
        except:
            time.sleep(1)

    # Check health
    try:
        r = requests.get(f"http://127.0.0.1:{PORT_BRIDGE}/health", timeout=5)
        health = r.json()
        print(f"\n📊 Services status:")
        for svc, status in health.get("services", {}).items():
            s = status.get("status", "unknown") if isinstance(status, dict) else status
            icon = "✅" if s in ("ok", "available") else "⚠️" if s == "offline" else "❌"
            print(f"   {icon} {svc}: {s}")
    except:
        print("⚠️ Bridge health check failed, but it may still be starting...")

    # ngrok
    if NGROK_TOKEN == "YOUR_NGROK_AUTH_TOKEN_HERE":
        print("\n⚠️ No ngrok token configured — skipping tunnel")
        print("   Set NGROK_TOKEN at the top of the script to enable public access")
        return

    from pyngrok import ngrok
    ngrok.set_auth_token(NGROK_TOKEN)
    ngrok.kill()
    time.sleep(1)
    tunnel = ngrok.connect(PORT_BRIDGE, "http", bind_tls=True)
    BASE = tunnel.public_url

    print("\n" + "=" * 60)
    print("🐝 NebChat Stack is READY!")
    print("=" * 60)
    print(f"\n🌐 BASE URL (use for everything): {BASE}")
    print(f"\n📝 In NebChat Settings, paste this URL in:")
    print(f"   1. Add Provider  → Base URL: {BASE}")
    print(f"   2. Add Provider  → API Key:  ollama")
    print(f"   3. Add Search    → Type: DuckDuckGo  → URL: {BASE}")
    print(f"   4. Page Reader URL:          {BASE}")
    print(f"\n🔧 Routes: /v1/* → Ollama | /search → Jina+DDG | /crawl → Crawl4AI+Jina")
    print(f"\n🔍 Search: Jina AI (fast, unlimited) → DuckDuckGo (fallback)")
    print(f"🕷️ Crawl: Crawl4AI → Jina Reader (fallback)")
    print("=" * 60)

# -------------------- HEALTH MONITOR --------------------
def health_monitor(interval=120):
    import requests
    while True:
        time.sleep(interval)
        try:
            r = requests.get(f"http://127.0.0.1:{PORT_BRIDGE}/health", timeout=10)
            data = r.json()
            status = data.get("status", "unknown")
            emoji = "✅" if status == "ok" else "⚠️"
            print(f"{emoji} System status: {status}")
        except Exception as exc:
            print(f"❌ Health check failed: {exc}")

# -------------------- RUN --------------------
print("🐝 Starting NebChat Colab Stack...")
print("=" * 60)

setup_system()
cleanup()
start_ollama()
start_crawl4ai()
ensure_models()
warmup_all()
start_bridge_and_tunnel()

# Start health monitor in background
threading.Thread(target=health_monitor, daemon=True).start()

# Colab keepalive
try:
    from google.colab import output
    js_code = """
    function KeepAlive() {
      console.log("Colab keepalive ping");
      document.querySelector("colab-connect-button")?.shadowRoot?.querySelector("#connect")?.click();
    }
    setInterval(KeepAlive, 60000);
    """
    output.eval_js(js_code)
    print("✅ Colab keepalive active (60s interval)")
except:
    print("⚠️ Not running in Colab — keepalive skipped")

print("\n🔄 Colab cell will stay alive. Don't close this tab!")
