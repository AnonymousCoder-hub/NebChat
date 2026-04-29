# ============================================================
# 🐝 NebChat Colab Setup — Jina AI Search + DuckDuckGo + Crawl4AI
# ============================================================
# Run this ENTIRE script in a single Colab cell.
# Sets up: Ollama + Jina Search + DuckDuckGo + Crawl4AI + Flask Proxy + ngrok
# ✨ ONLY ONE ngrok tunnel — same URL for Chat, Search & Page Reading
# 🚫 No Docker needed!
# 🔍 Jina AI Search: Free, fast, unlimited, no API key, no rate limits
# ============================================================

import os
import subprocess
import time
import requests
import threading
import shutil
import json

# -------------------- CONFIG --------------------
NGROK_TOKEN = "YOUR_NGROK_AUTH_TOKEN_HERE"  # <-- Replace with your ngrok token!
PORT_OLLAMA = 11434
PORT_CRAWL4AI = 8020
PORT_BRIDGE = 5000

MODELS = ["qwen3:8b"]  # Add more models if needed, e.g. "gemma3:4b", "deepseek-r1:8b"

# -------------------- SETUP --------------------
def setup_system():
    print("📦 Setting up system dependencies...")
    if shutil.which("zstd") is None:
        os.system("apt-get update -y && apt-get install -y zstd")

    try:
        import flask, flask_cors, pyngrok
    except:
        os.system("pip install -q flask flask-cors pyngrok")

    # Install DuckDuckGo search library (fallback)
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
    os.system("pkill -9 -f crawl4ai_server 2>/dev/null || true")
    os.system("pkill -9 -f unified_proxy 2>/dev/null || true")
    os.system(f"fuser -k {PORT_OLLAMA}/tcp 2>/dev/null || true")
    os.system(f"fuser -k {PORT_BRIDGE}/tcp 2>/dev/null || true")
    os.system(f"fuser -k {PORT_CRAWL4AI}/tcp 2>/dev/null || true")
    time.sleep(2)

# -------------------- START OLLAMA --------------------
def start_ollama():
    env = os.environ.copy()
    env["OLLAMA_KEEP_ALIVE"] = "-1"           # Keep models loaded forever
    env["OLLAMA_NUM_PARALLEL"] = "4"          # Handle 4 concurrent requests
    env["OLLAMA_MAX_LOADED_MODELS"] = "3"     # Keep up to 3 models in memory
    env["OLLAMA_GPU_LAYERS"] = "999"          # Offload all layers to GPU
    env["OLLAMA_FLASH_ATTENTION"] = "1"       # Flash attention for faster inference
    env["OLLAMA_KV_CACHE_TYPE"] = "q8_0"      # 8-bit KV cache = less VRAM, more room
    env["OLLAMA_CONTEXT_LENGTH"] = "8192"      # Limit context to prevent memory bloat

    print("🚀 Starting Ollama...")
    # Log stderr to file for debugging
    log_file = open("/content/ollama.log", "w")
    subprocess.Popen(
        ["ollama", "serve"],
        stdout=subprocess.DEVNULL,
        stderr=log_file,
        env=env
    )

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
                    "markdown": result.markdown_v2.raw_markdown if hasattr(result, 'markdown_v2') else result.markdown,
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

    with open('/content/crawl4ai_server.py', 'w') as f:
        f.write(crawl_script)

    print("🕷️ Starting Crawl4AI server...")
    subprocess.Popen(
        ['python', '/content/crawl4ai_server.py'],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL
    )

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
    print("🔥 Warming up models...")

    for model in MODELS:
        print(f"⚡ Warming {model}...")
        try:
            requests.post(
                f"http://127.0.0.1:{PORT_OLLAMA}/api/generate",
                json={
                    "model": model,
                    "prompt": "hi",
                    "stream": False
                },
                timeout=240
            )
        except:
            pass

    print("✅ Warmed up successfully!")

# -------------------- JINA AI SEARCH --------------------
# Free, fast, unlimited search API. No API key needed.
# Returns search results WITH page content in one call.
# Endpoint: https://s.jina.ai/{query}
# Headers: Accept: application/json

def jina_search(query, max_results=10):
    """Search using Jina AI — fast, free, no rate limits, returns content"""
    try:
        resp = requests.get(
            f"https://s.jina.ai/{query}",
            headers={
                "Accept": "application/json",
            },
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
                "content": item.get("content", "")[:3000],  # Truncate to 3000 chars
                "description": item.get("description", ""),
            })
        return results
    except Exception as e:
        print(f"⚠️ Jina search error: {e}")
        return None

def duckduckgo_search(query, max_results=10):
    """Fallback search using DuckDuckGo"""
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
            # Also try news
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
    """Read a single page using Jina Reader — free, fast, no API key"""
    try:
        resp = requests.get(
            f"https://r.jina.ai/{url}",
            headers={"Accept": "text/plain"},
            timeout=15
        )
        if resp.ok:
            return resp.text[:5000]  # Truncate
        return None
    except:
        return None

# -------------------- UNIFIED BRIDGE --------------------
def start_bridge_and_tunnel():
    from flask import Flask, request, Response, stream_with_context, jsonify
    from flask_cors import CORS
    from pyngrok import ngrok

    app = Flask(__name__)
    CORS(app)

    OLLAMA = f"http://127.0.0.1:{PORT_OLLAMA}"
    CRAWL4AI = f"http://127.0.0.1:{PORT_CRAWL4AI}"

    @app.route('/')
    def root():
        """Root endpoint — shows status"""
        return jsonify({
            "status": "ok",
            "service": "NebChat Proxy",
            "endpoints": {
                "/v1/*": "Ollama OpenAI-compatible API",
                "/api/*": "Ollama native API",
                "/search": "Search (Jina AI → DuckDuckGo fallback)",
                "/crawl": "Crawl4AI page reader (fallback: Jina Reader)",
                "/health": "Service health check",
            }
        })

    @app.route('/v1/<path:path>', methods=['GET','POST','PUT','DELETE','OPTIONS'])
    def ollama_v1(path):
        """Route /v1/* to Ollama (chat, models, etc.)"""
        url = f"{OLLAMA}/v1/{path}"
        def generate():
            resp = requests.request(
                method=request.method,
                url=url,
                headers={k: v for (k, v) in request.headers if k.lower() not in ('host', 'origin')},
                data=request.get_data(),
                stream=True,
                timeout=300
            )
            for chunk in resp.iter_content(chunk_size=8192):
                if chunk:
                    yield chunk
        content_type = 'text/event-stream' if 'chat/completions' in path else 'application/json'
        return Response(stream_with_context(generate()), content_type=content_type)

    @app.route('/api/<path:path>', methods=['GET','POST','PUT','DELETE','OPTIONS'])
    def ollama_native(path):
        """Route /api/* to Ollama native API"""
        url = f"{OLLAMA}/api/{path}"
        def generate():
            resp = requests.request(
                method=request.method,
                url=url,
                headers={k: v for (k, v) in request.headers if k.lower() not in ('host', 'origin')},
                data=request.get_data(),
                stream=True,
                timeout=300
            )
            for chunk in resp.iter_content(chunk_size=8192):
                if chunk:
                    yield chunk
        return Response(stream_with_context(generate()), content_type='application/json')

    @app.route('/search', methods=['GET'])
    def search():
        """Search: Jina AI first (fast, unlimited), DuckDuckGo fallback"""
        query = request.args.get('q', '')
        max_results = int(request.args.get('max_results', 10))

        if not query:
            return jsonify({"error": "Missing query parameter 'q'"}), 400

        # --- Try Jina AI Search first (fast, reliable, unlimited) ---
        results = jina_search(query, max_results)
        if results and len(results) > 0:
            # Normalize Jina results to match expected format
            normalized = []
            for r in results:
                normalized.append({
                    "title": r.get("title", ""),
                    "url": r.get("url", ""),
                    "content": r.get("content", r.get("description", "")),
                })
            return jsonify({"results": normalized, "source": "jina"})

        # --- Fallback: DuckDuckGo ---
        print(f"⚠️ Jina search failed for '{query}', trying DuckDuckGo...")
        results = duckduckgo_search(query, max_results)
        if results and len(results) > 0:
            return jsonify({"results": results, "source": "duckduckgo"})

        return jsonify({"error": "All search providers failed", "results": []}), 500

    @app.route('/crawl', methods=['POST','OPTIONS'])
    def crawl():
        """Read a page: Crawl4AI first, Jina Reader fallback"""
        if request.method == "OPTIONS":
            return Response(status=204)

        data = request.json or {}
        url = data.get("url", "")
        if not url:
            return jsonify({"error": "URL is required"}), 400

        # --- Try Crawl4AI first ---
        try:
            resp = requests.post(f"{CRAWL4AI}/crawl", json=data, timeout=20)
            if resp.ok:
                crawl_data = resp.json()
                if crawl_data.get("success", False) or crawl_data.get("content", {}).get("markdown"):
                    return Response(resp.content, status=200, content_type='application/json')
        except:
            pass

        # --- Fallback: Jina Reader ---
        print(f"⚠️ Crawl4AI failed for {url}, trying Jina Reader...")
        content = jina_read_page(url)
        if content:
            return jsonify({
                "url": url,
                "content": {"markdown": content},
                "success": True,
                "status_code": 200,
            })

        return jsonify({"error": "Page reading failed", "success": False}), 500

    @app.route('/health', methods=['GET'])
    def health():
        """Health check for all services"""
        services = {}

        # Ollama
        try:
            r = requests.get(f"{OLLAMA}/api/tags", timeout=3)
            services["ollama"] = "ok" if r.ok else "error"
        except:
            services["ollama"] = "offline"

        # Crawl4AI
        try:
            r = requests.get(f"{CRAWL4AI}/health", timeout=3)
            services["crawl4ai"] = "ok" if r.ok else "error"
        except:
            services["crawl4ai"] = "offline"

        # Jina Search
        try:
            r = requests.get("https://s.jina.ai/test", headers={"Accept": "application/json"}, timeout=5)
            services["jina_search"] = "ok" if r.ok else "error"
        except:
            services["jina_search"] = "error"

        # DuckDuckGo
        try:
            from duckduckgo_search import DDGS
            with DDGS() as ddgs:
                test_results = list(ddgs.text("test", max_results=1))
                services["duckduckgo"] = "ok" if test_results else "empty"
        except:
            services["duckduckgo"] = "error"

        return {"status": "ok", "services": services}

    threading.Thread(
        target=lambda: app.run(port=PORT_BRIDGE, host='0.0.0.0', use_reloader=False, threaded=True),
        daemon=True
    ).start()

    time.sleep(2)

    # Verify bridge health
    try:
        r = requests.get(f"http://127.0.0.1:{PORT_BRIDGE}/health", timeout=5)
        health = r.json()
        print(f"\n📊 Services status:")
        for svc, status in health.get("services", {}).items():
            icon = "✅" if status == "ok" else "⚠️" if status == "offline" else "❌"
            print(f"   {icon} {svc}: {status}")
    except:
        print("⚠️ Bridge health check failed, but it may still be starting...")

    ngrok.set_auth_token(NGROK_TOKEN)
    ngrok.kill()
    time.sleep(1)
    tunnel = ngrok.connect(PORT_BRIDGE, "http", bind_tls=True)

    BASE = tunnel.public_url
    print("\n" + "="*60)
    print(f"🐝 NebChat Stack is READY!")
    print("="*60)
    print(f"\n🌐 BASE URL (use for everything): {BASE}")
    print(f"\n📝 In NebChat Settings, paste this URL in:")
    print(f"   1. Add Provider  → Base URL: {BASE}")
    print(f"   2. Add Provider  → API Key:  ollama")
    print(f"   3. Add Search    → Type: DuckDuckGo  → Base URL: {BASE}")
    print(f"   4. Page Reader URL:          {BASE}")
    print(f"\n🔧 Routes: /v1/* → Ollama | /search → Jina+DDG | /crawl → Crawl4AI+Jina")
    print(f"\n🔍 Search Priority: Jina AI (fast, unlimited) → DuckDuckGo (fallback)")
    print(f"🕷️ Crawl Priority: Crawl4AI → Jina Reader (fallback)")
    print(f"\n💡 Tips:")
    print(f"   - Jina Search is free, fast, and has NO rate limits!")
    print(f"   - It returns page content directly — no separate crawl needed for most queries")
    print(f"   - Enable Search toggle in chat for web-grounded answers")
    print(f"   - Ollama is configured for parallel requests (4 concurrent)")
    print("="*60)

# -------------------- RUN --------------------
print("🐝 Starting NebChat Colab Stack...")
print("="*60)

setup_system()
cleanup()
start_ollama()
start_crawl4ai()
ensure_models()
warmup_all()
start_bridge_and_tunnel()

# Keep alive
print("\n🔄 Colab cell will stay alive. Don't close this tab!")
print("   If Colab disconnects, re-run this cell.\n")
