#!/usr/bin/env python3
# ============================================================
#  NebChat Colab Setup — v3.1
#  Ollama + Agentic Search + Crawl4AI + Flask Bridge + ngrok
#  Features: AI-powered web search, page reading, reasoning_effort
#  Search: SearXNG + Wikipedia + DDG HTML + DDG library
#  Content: Trafilatura + Jina Reader + Crawl4AI + BeautifulSoup
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
        import trafilatura
    except:
        print("📄 Installing Trafilatura (primary content extractor)...")
        os.system("pip install -q trafilatura")
    try:
        from bs4 import BeautifulSoup
    except:
        print("🍲 Installing BeautifulSoup4 (fallback HTML parser)...")
        os.system("pip install -q beautifulsoup4")
    try:
        from duckduckgo_search import DDGS
    except:
        print("🔍 Installing DuckDuckGo Search (fallback)...")
        os.system("pip install -q duckduckgo-search")
    try:
        import requests
    except:
        os.system("pip install -q requests")
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

# -------------------- BRIDGE (written to file) --------------------
def write_bridge_file():
    bridge_path = "/content/nebchat_bridge.py"
    with open(bridge_path, "w") as f:
        f.write(BRIDGE_CODE)
    print(f"📝 Bridge script written to {bridge_path}")
    return bridge_path

BRIDGE_CODE = r'''#!/usr/bin/env python3
# NebChat Agentic Bridge v3.1 — Flask application
# Supports: Ollama proxy, Agentic search/crawl, SSE keepalive
# Search: SearXNG -> Wikipedia -> DDG HTML -> DDG library
# Content: Trafilatura -> Jina Reader -> Crawl4AI -> BeautifulSoup

import os, sys, time, json, traceback, threading, queue, random, re
import urllib.request, urllib.error, urllib.parse
from datetime import datetime, timezone
from flask import Flask, Response, request, jsonify, stream_with_context
from flask_cors import CORS
import requests as req_lib

PORT_OLLAMA = int(os.environ.get("PORT_OLLAMA", 11434))
PORT_CRAWL4AI = int(os.environ.get("PORT_CRAWL4AI", 8020))
OLLAMA_BASE = f"http://localhost:{PORT_OLLAMA}"
CRAWL4AI_BASE = f"http://localhost:{PORT_CRAWL4AI}"
JINA_READER_URL = "https://r.jina.ai/"
KEEPALIVE_INTERVAL = 15
AGENTIC_MAX_ROUNDS = 5

# SearXNG public instances — shuffled for load distribution
SEARXNG_INSTANCES = [
    "https://searx.rhscz.eu",
    "https://search.zina.dev",
    "https://search.bladerunn.in",
    "https://searx.be",
    "https://search.bus-hit.me",
    "https://searx.fmac.xyz",
    "https://search.mdosch.de",
    "https://searxng.ch",
    "https://search.sapti.me",
]

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

# ==================== QUERY TYPE DETECTION ====================
FACTUAL_PATTERNS = re.compile(
    r'\b(who is|who was|what is|what are|what was|what were|define|definition|meaning of|'
    r'explain|how does|how do|how did|history of|origin of|biography|born|died|'
    r'capital of|population of|area of|founder of|inventor of|'
    r'wikipedia|encyclopedia|overview|summary of)\b',
    re.IGNORECASE
)

NEWS_PATTERNS = re.compile(
    r'\b(latest|recent|current|today|this week|this month|this year|breaking|'
    r'news|update|updated|just happened|live|now|price of|stock|'
    r'score|result|weather|forecast|election|released|announced)\b',
    re.IGNORECASE
)

def _detect_query_type(query):
    """Detect whether a query is factual, news/real-time, or general.
    Returns: 'factual', 'news', or 'general'
    """
    if NEWS_PATTERNS.search(query):
        return "news"
    if FACTUAL_PATTERNS.search(query):
        return "factual"
    return "general"

# ==================== TOOL DEFINITIONS ====================
AGENTIC_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": "Search the web for up-to-date information. Returns titles, URLs, and snippets.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "The search query"}
                },
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "read_page",
            "description": "Read the full content of a web page as markdown. Use for detailed info from URLs found via search.",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "The URL to read"}
                },
                "required": ["url"]
            }
        }
    }
]

# ==================== SEARCH IMPLEMENTATIONS ====================

def _search_searxng(query, max_results=10, categories="general"):
    """SearXNG metasearch — aggregates Google + Bing + 250+ engines via public instances."""
    instances = SEARXNG_INSTANCES[:]
    random.shuffle(instances)
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json",
    }
    for instance in instances:
        try:
            params = {
                "q": query,
                "format": "json",
                "categories": categories,
                "language": "en",
            }
            resp = req_lib.get(
                f"{instance}/search",
                params=params,
                headers=headers,
                timeout=10,
                allow_redirects=True,
            )
            if resp.status_code != 200:
                continue
            data = resp.json()
            results = []
            for item in data.get("results", [])[:max_results]:
                # SearXNG results can have different fields
                title = item.get("title", "")
                url = item.get("url", item.get("link", ""))
                snippet = item.get("content", item.get("snippet", ""))
                if not url:
                    continue
                results.append({
                    "title": title,
                    "url": url,
                    "snippet": (snippet or "")[:500],
                })
            if results:
                print(f"[SEARCH] SearXNG hit from {instance} ({len(results)} results)", flush=True)
                return results
        except Exception as e:
            print(f"[SEARCH] SearXNG {instance} failed: {e}", flush=True)
            continue
    return None

def _search_wikipedia(query, max_results=5):
    """Wikipedia API search — excellent for factual/encyclopedic queries."""
    try:
        # Step 1: Search for pages matching the query
        search_params = {
            "action": "query",
            "list": "search",
            "srsearch": query,
            "srlimit": max_results,
            "format": "json",
            "utf8": 1,
        }
        resp = req_lib.get(
            "https://en.wikipedia.org/w/api.php",
            params=search_params,
            timeout=10,
            headers={"User-Agent": "NebChatBridge/3.1 (https://github.com/nebchat)"},
        )
        if resp.status_code != 200:
            return None
        data = resp.json()
        search_results = data.get("query", {}).get("search", [])
        if not search_results:
            return None

        results = []
        page_ids = [str(r["pageid"]) for r in search_results]

        # Step 2: Get extracts (content snippets) for found pages
        extract_params = {
            "action": "query",
            "prop": "extracts",
            "exintro": True,
            "explaintext": True,
            "exsentences": 5,
            "pageids": "|".join(page_ids),
            "format": "json",
            "utf8": 1,
        }
        extract_resp = req_lib.get(
            "https://en.wikipedia.org/w/api.php",
            params=extract_params,
            timeout=10,
            headers={"User-Agent": "NebChatBridge/3.1 (https://github.com/nebchat)"},
        )
        extracts = {}
        if extract_resp.status_code == 200:
            pages = extract_resp.json().get("query", {}).get("pages", {})
            for pid, pdata in pages.items():
                extracts[pid] = pdata.get("extract", "")

        for item in search_results:
            page_id = str(item["pageid"])
            title = item.get("title", "")
            url = f"https://en.wikipedia.org/wiki/{urllib.parse.quote(title.replace(' ', '_'))}"
            snippet = extracts.get(page_id, item.get("snippet", ""))
            # Clean HTML from snippet if present
            snippet = re.sub(r'<[^>]+>', '', snippet)[:500]
            results.append({
                "title": f"{title} — Wikipedia",
                "url": url,
                "snippet": snippet,
            })
        if results:
            print(f"[SEARCH] Wikipedia returned {len(results)} results", flush=True)
        return results if results else None
    except Exception as e:
        print(f"[SEARCH] Wikipedia failed: {e}", flush=True)
        return None

def _search_ddg_html(query, max_results=8):
    """DuckDuckGo HTML scraping — reliable fallback using BeautifulSoup."""
    try:
        from bs4 import BeautifulSoup
        ddg_url = "https://html.duckduckgo.com/html/"
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        }
        data = {"q": query, "b": "", "kl": "us-en"}
        resp = req_lib.post(ddg_url, data=data, headers=headers, timeout=10, allow_redirects=True)
        if resp.status_code != 200:
            return None
        soup = BeautifulSoup(resp.text, "html.parser")
        results = []
        for result_div in soup.find_all("div", class_="result"):
            title_tag = result_div.find("a", class_="result__a")
            snippet_tag = result_div.find("a", class_="result__snippet")
            if not title_tag:
                continue
            title = title_tag.get_text(strip=True)
            href = title_tag.get("href", "")
            # DDG HTML uses redirect URLs — extract the real URL
            if href and "uddg=" in href:
                real_url = urllib.parse.parse_qs(urllib.parse.urlparse(href).query).get("uddg", [href])
                href = real_url[0] if real_url else href
            snippet = snippet_tag.get_text(strip=True) if snippet_tag else ""
            if title and href:
                results.append({
                    "title": title,
                    "url": href,
                    "snippet": snippet[:500],
                })
            if len(results) >= max_results:
                break
        if results:
            print(f"[SEARCH] DDG HTML returned {len(results)} results", flush=True)
        return results if results else None
    except Exception as e:
        print(f"[SEARCH] DDG HTML failed: {e}", flush=True)
        return None

def _search_ddg_library(query, max_results=8):
    """DuckDuckGo Search library — kept as final fallback."""
    try:
        from duckduckgo_search import DDGS
        with DDGS() as ddgs:
            ddg_results = list(ddgs.text(query, max_results=max_results))
        if ddg_results:
            results = []
            for r in ddg_results:
                results.append({
                    "title": r.get("title", ""),
                    "url": r.get("href", ""),
                    "snippet": r.get("body", "")[:500],
                })
            print(f"[SEARCH] DDG library returned {len(results)} results", flush=True)
            return results
    except Exception as e:
        print(f"[SEARCH] DDG library failed: {e}", flush=True)
    return None

# ==================== CONTENT EXTRACTION IMPLEMENTATIONS ====================

def _extract_trafilatura(url):
    """Trafilatura — fast, high-quality content extraction from web pages."""
    try:
        import trafilatura
        # Download the page
        downloaded = trafilatura.fetch_url(url)
        if not downloaded:
            return None
        # Extract main content as markdown
        content = trafilatura.extract(
            downloaded,
            output_format="markdown",
            include_links=True,
            include_tables=True,
            favor_precision=True,
        )
        if content and len(content.strip()) > 50:
            print(f"[EXTRACT] Trafilatura extracted {len(content)} chars from {url}", flush=True)
            return content[:5000]
    except Exception as e:
        print(f"[EXTRACT] Trafilatura failed: {e}", flush=True)
    return None

def _extract_jina_reader(url):
    """Jina Reader — good for JS-heavy sites that need server-side rendering."""
    try:
        jina_url = f"{JINA_READER_URL}{urllib.parse.quote(url, safe=':/?#[]@!$&()*+,;=')}"
        headers = {"Accept": "text/markdown"}
        jina_key = os.environ.get("JINA_API_KEY", "")
        if jina_key:
            headers["Authorization"] = f"Bearer {jina_key}"
        resp = req_lib.get(jina_url, headers=headers, timeout=20, allow_redirects=True)
        content = resp.text
        if content and len(content.strip()) > 50:
            print(f"[EXTRACT] Jina Reader extracted {len(content)} chars from {url}", flush=True)
            return content[:5000]
    except Exception as e:
        print(f"[EXTRACT] Jina Reader failed: {e}", flush=True)
    return None

def _extract_crawl4ai(url):
    """Crawl4AI — browser-based extraction for dynamic pages."""
    try:
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
            if content and len(content.strip()) > 50:
                print(f"[EXTRACT] Crawl4AI extracted {len(content)} chars from {url}", flush=True)
                return content[:5000]
    except Exception as e:
        print(f"[EXTRACT] Crawl4AI failed: {e}", flush=True)
    return None

def _extract_beautifulsoup(url):
    """BeautifulSoup fallback — basic HTML to text extraction."""
    try:
        from bs4 import BeautifulSoup
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        }
        resp = req_lib.get(url, headers=headers, timeout=15, allow_redirects=True)
        if resp.status_code != 200:
            return None
        soup = BeautifulSoup(resp.text, "html.parser")
        # Remove unwanted elements
        for tag in soup.find_all(["script", "style", "nav", "footer", "header", "aside", "iframe", "noscript"]):
            tag.decompose()
        # Try to find main content area
        main = soup.find("main") or soup.find("article") or soup.find("div", class_=re.compile(r"content|article|post|entry", re.I))
        if main:
            text = main.get_text(separator="\n", strip=True)
        else:
            text = soup.get_text(separator="\n", strip=True)
        # Clean up excessive whitespace
        lines = [line.strip() for line in text.splitlines() if line.strip()]
        text = "\n".join(lines)
        if text and len(text) > 50:
            print(f"[EXTRACT] BeautifulSoup extracted {len(text)} chars from {url}", flush=True)
            return text[:5000]
    except Exception as e:
        print(f"[EXTRACT] BeautifulSoup failed: {e}", flush=True)
    return None

# ==================== UNIFIED TOOL EXECUTION ====================

def _tool_web_search(query, max_results=10):
    """Multi-layer search: SearXNG -> Wikipedia -> DDG HTML -> DDG library.
    Automatically routes factual queries to Wikipedia first,
    and news/real-time queries to SearXNG with categories=news.
    """
    query_type = _detect_query_type(query)
    print(f"[AGENTIC] Search query type: {query_type} for: '{query[:80]}'", flush=True)

    results = None

    # For factual queries, try Wikipedia first (most reliable for facts)
    if query_type == "factual":
        results = _search_wikipedia(query, max_results=max_results)
        if results:
            return json.dumps(results)

    # For news/real-time queries, use SearXNG with news category
    if query_type == "news":
        results = _search_searxng(query, max_results=max_results, categories="news")
        if results:
            return json.dumps(results)
        # Fall through to general SearXNG

    # Primary: SearXNG general search (aggregates Google + Bing + 250+ engines)
    results = _search_searxng(query, max_results=max_results, categories="general")
    if results:
        return json.dumps(results)

    # For factual queries that didn't get Wikipedia results, try it now as fallback
    if query_type != "factual":
        results = _search_wikipedia(query, max_results=max_results)
        if results:
            return json.dumps(results)

    # Fallback: DDG HTML scraping
    results = _search_ddg_html(query, max_results=max_results)
    if results:
        return json.dumps(results)

    # Final fallback: DDG library
    results = _search_ddg_library(query, max_results=max_results)
    if results:
        return json.dumps(results)

    return json.dumps({"error": "All search methods failed"})

def _tool_read_page(url):
    """Multi-layer content extraction: Trafilatura -> Jina Reader -> Crawl4AI -> BeautifulSoup."""
    # Primary: Trafilatura (fast, high quality)
    content = _extract_trafilatura(url)
    if content:
        return content[:4000]

    # Fallback 1: Jina Reader (good for JS-heavy sites)
    content = _extract_jina_reader(url)
    if content:
        return content[:4000]

    # Fallback 2: Crawl4AI (browser-based, handles dynamic pages)
    content = _extract_crawl4ai(url)
    if content:
        return content[:4000]

    # Fallback 3: BeautifulSoup (basic HTML parsing)
    content = _extract_beautifulsoup(url)
    if content:
        return content[:4000]

    return "Failed to read page content."

def _execute_tool(name, args):
    if name == "web_search":
        return _tool_web_search(args.get("query", ""))
    elif name == "read_page":
        return _tool_read_page(args.get("url", ""))
    return json.dumps({"error": f"Unknown tool: {name}"})

# ==================== STREAMING HELPERS ====================
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
                        yield b": keepalive\n\n"
                        last_ka = time.time()
            if errors:
                yield f"data: {{'error': '{errors[0]}'}}\n\n".encode()

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

def _simulated_stream(content, thinking, model):
    """Simulate SSE streaming for agentic responses — sends in chunks for smooth display."""
    def generate():
        chunk_id = f"chatcmpl-{int(time.time()*1000)}"
        ts = int(time.time())

        # Send thinking content first (if any)
        if thinking:
            for i in range(0, len(thinking), 30):
                data = {
                    "id": chunk_id, "object": "chat.completion.chunk", "created": ts, "model": model,
                    "choices": [{"index": 0, "delta": {"reasoning_content": thinking[i:i+30]}, "finish_reason": None}],
                }
                yield f"data: {json.dumps(data)}\n\n"

        # Send content in chunks
        for i in range(0, len(content), 20):
            delta = {}
            if i == 0:
                delta["role"] = "assistant"
            delta["content"] = content[i:i+20]
            data = {
                "id": chunk_id, "object": "chat.completion.chunk", "created": ts, "model": model,
                "choices": [{"index": 0, "delta": delta, "finish_reason": None}],
            }
            yield f"data: {json.dumps(data)}\n\n"

        # Done
        data = {
            "id": chunk_id, "object": "chat.completion.chunk", "created": ts, "model": model,
            "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
        }
        yield f"data: {json.dumps(data)}\n\n"
        yield "data: [DONE]\n\n"

    return Response(
        stream_with_context(generate()),
        content_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

# ==================== AGENTIC CHAT HANDLER ====================
def _ollama_call(body_json):
    """Make a non-streaming call to Ollama and return the parsed response."""
    body_json["stream"] = False
    req_body = json.dumps(body_json).encode("utf-8")
    req = urllib.request.Request(
        f"{OLLAMA_BASE}/v1/chat/completions",
        data=req_body,
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    with urllib.request.urlopen(req, timeout=300) as resp:
        return json.loads(resp.read())

AGENTIC_SYSTEM_PROMPT = """You are an AI assistant with web search and page reading capabilities. You have access to the following tools:
- web_search: Search the web for current, up-to-date information. Returns titles, URLs, and snippets.
- read_page: Read the full content of a web page as markdown. Use for detailed info from URLs found via search.

CRITICAL RULES:
1. When the user asks about current events, stock prices, weather, news, recent data, or ANY time-sensitive information, you MUST use the web_search tool FIRST before responding. Do NOT say you cannot access the internet — you CAN and MUST search.
2. When the user asks "what is the price of X", "what happened today", "latest news about Y", or similar real-time queries, ALWAYS call web_search immediately.
3. After searching, if you need more detailed information from a specific URL, use the read_page tool to get the full content.
4. Only respond without searching if the question is about general knowledge, math, coding, or topics that don't require current data.
5. Never say "I don't have access to real-time data" or "I can't browse the internet" — you CAN search using your tools.
6. Always cite your sources by including URLs from the search results in your response."""

def _handle_agentic(body_json, should_stream):
    """Agentic loop: AI decides when to search/read, executes tools, returns final answer."""
    messages = list(body_json.get("messages", []))
    model = body_json.get("model", "qwen3:8b")

    # Inject agentic system prompt if no system message exists
    has_system = any(m.get("role") == "system" for m in messages)
    if not has_system:
        messages.insert(0, {"role": "system", "content": AGENTIC_SYSTEM_PROMPT})
    else:
        # Prepend agentic instructions to existing system prompt
        for m in messages:
            if m.get("role") == "system":
                m["content"] = AGENTIC_SYSTEM_PROMPT + "\n\n" + m.get("content", "")
                break

    # Inject tools
    body_json["tools"] = AGENTIC_TOOLS
    body_json["tool_choice"] = "auto"

    response_data = None

    for round_num in range(AGENTIC_MAX_ROUNDS):
        body_json["messages"] = messages
        try:
            response_data = _ollama_call(body_json)
        except Exception as e:
            return jsonify({"error": f"Ollama error: {e}"}), 502

        choice = response_data.get("choices", [{}])[0]
        message = choice.get("message", {})
        tool_calls = message.get("tool_calls", [])

        if not tool_calls:
            break  # Final response — no more tool calls

        # Process tool calls
        messages.append(message)
        for tc in tool_calls:
            func = tc.get("function", {})
            name = func.get("name", "")
            args = json.loads(func.get("arguments", "{}"))
            tc_id = tc.get("id", "")

            print(f"[AGENTIC] Round {round_num+1}: {name}({json.dumps(args)[:100]})", flush=True)
            result = _execute_tool(name, args)

            messages.append({
                "role": "tool",
                "tool_call_id": tc_id,
                "content": result,
            })

    # Get final content
    if response_data is None:
        return jsonify({"error": "No response from Ollama"}), 502

    final_message = response_data.get("choices", [{}])[0].get("message", {})
    final_content = final_message.get("content", "")
    final_thinking = final_message.get("reasoning_content", final_message.get("thinking", ""))

    if should_stream:
        return _simulated_stream(final_content, final_thinking, model)
    else:
        return jsonify(response_data)

# ==================== ROUTES ====================
@app.route("/")
def index():
    return jsonify({
        "service": "NebChat Agentic Bridge",
        "version": "3.1",
        "agentic": True,
        "endpoints": {
            "GET /": "Status page",
            "GET /v1/models": "List Ollama models",
            "POST /v1/chat/completions": "Chat (supports agentic mode with tools)",
            "* /v1/<path>": "Proxy to Ollama /v1/*",
            "* /api/<path>": "Proxy to Ollama /api/*",
            "GET /search?q=...": "Search (SearXNG + Wikipedia + DDG fallback)",
            "POST /crawl": "Read page (Trafilatura + Jina + Crawl4AI + BS4 fallback)",
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
    body_raw = request.get_data()
    body_json = json.loads(body_raw) if body_raw else {}
    is_agentic = body_json.get("agentic", False)

    if is_agentic:
        should_stream = body_json.get("stream", True)
        return _handle_agentic(body_json, should_stream)

    # Normal proxy
    headers = {"Content-Type": request.content_type or "application/json"}
    return _stream_response(
        _proxy_url(OLLAMA_BASE, "v1/chat/completions"),
        method="POST", headers=headers, body=body_raw,
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

    query_type = _detect_query_type(query)
    source = "none"
    results = None

    # For factual queries, try Wikipedia first
    if query_type == "factual":
        results = _search_wikipedia(query, max_results=max_results)
        if results:
            source = "wikipedia"

    # For news queries, try SearXNG news category first
    if not results and query_type == "news":
        results = _search_searxng(query, max_results=max_results, categories="news")
        if results:
            source = "searxng_news"

    # General SearXNG search (primary for most queries)
    if not results:
        results = _search_searxng(query, max_results=max_results, categories="general")
        if results:
            source = "searxng"

    # Wikipedia fallback (for non-factual queries that didn't try Wikipedia yet)
    if not results and query_type != "factual":
        results = _search_wikipedia(query, max_results=max_results)
        if results:
            source = "wikipedia"

    # DDG HTML scraping fallback
    if not results:
        results = _search_ddg_html(query, max_results=max_results)
        if results:
            source = "ddg_html"

    # DDG library fallback
    if not results:
        results = _search_ddg_library(query, max_results=max_results)
        if results:
            source = "ddg_library"

    if results:
        formatted = []
        for r in results:
            formatted.append({
                "title": r.get("title", ""),
                "url": r.get("url", ""),
                "description": r.get("snippet", r.get("description", "")),
                "content": r.get("snippet", ""),
            })
        return jsonify({"query": query, "query_type": query_type, "source": source, "results": formatted})

    return jsonify({
        "query": query, "query_type": query_type, "source": "none", "results": [],
        "error": "All search methods failed",
    }), 502

@app.route("/crawl", methods=["POST"])
def crawl():
    payload = request.get_json(silent=True) or {}
    url = payload.get("url", "").strip()
    if not url:
        return jsonify({"error": "Missing 'url' in request body"}), 400

    # Primary: Trafilatura
    content = _extract_trafilatura(url)
    if content:
        return jsonify({"url": url, "source": "trafilatura", "content": {"markdown": content}, "success": True, "status_code": 200})

    # Fallback 1: Jina Reader
    content = _extract_jina_reader(url)
    if content:
        return jsonify({"url": url, "source": "jina_reader", "content": {"markdown": content}, "success": True, "status_code": 200})

    # Fallback 2: Crawl4AI
    content = _extract_crawl4ai(url)
    if content:
        return jsonify({"url": url, "source": "crawl4ai", "content": {"markdown": content}, "success": True, "status_code": 200})

    # Fallback 3: BeautifulSoup
    content = _extract_beautifulsoup(url)
    if content:
        return jsonify({"url": url, "source": "beautifulsoup", "content": {"markdown": content}, "success": True, "status_code": 200})

    return jsonify({
        "url": url, "source": "none", "content": {"markdown": ""},
        "success": False, "error": "All content extraction methods failed (Trafilatura, Jina Reader, Crawl4AI, BeautifulSoup)",
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
    services["searxng"] = {"status": "available", "instances": len(SEARXNG_INSTANCES)}
    services["wikipedia"] = {"status": "available"}
    services["trafilatura"] = {"status": "available"}
    services["agentic"] = {"status": "enabled"}
    return jsonify({"status": "ok", "services": services})

@app.errorhandler(404)
def not_found(e):
    return jsonify({"error": "Not found", "path": request.path}), 404

@app.errorhandler(500)
def server_error(e):
    return jsonify({"error": "Internal server error", "detail": str(e)}), 500

if __name__ == "__main__":
    print("=" * 60)
    print("  NebChat Agentic Bridge v3.1")
    print(f"  Ollama:   {OLLAMA_BASE}")
    print(f"  Crawl4AI: {CRAWL4AI_BASE}")
    print(f"  Search:   SearXNG ({len(SEARXNG_INSTANCES)} instances) + Wikipedia + DDG")
    print(f"  Extract:  Trafilatura + Jina Reader + Crawl4AI + BS4")
    print(f"  Agentic:  Enabled (max {AGENTIC_MAX_ROUNDS} rounds)")
    print("=" * 60)
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT_BRIDGE", 5000)), debug=False, threaded=True)
'''

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
            icon = "✅" if s in ("ok", "available", "enabled") else "⚠️" if s == "offline" else "❌"
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
    print(f"\n📝 In NebChat Settings:")
    print(f"   1. Add Provider → Base URL: {BASE}")
    print(f"   2. Add Provider → API Key:  ollama")
    print(f"   3. Add Search  → Type: SearXNG → URL: {BASE}")
    print(f"   4. Page Reader URL:          {BASE}")
    print(f"\n🤖 Agentic Mode: AI can search & read web pages autonomously!")
    print(f"   Toggle Search ON in chat → AI decides when to search")
    print(f"\n🔧 Routes: /v1/* → Ollama | /search → SearXNG+Wiki+DDG | /crawl → Trafilatura+Jina+Crawl4AI+BS4")
    print(f"💡 reasoning_effort: Send in chat request body (high/none)")
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
