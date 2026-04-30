#!/usr/bin/env python3
# NebChat v5.0 — Ollama + Playwright + Crawl4AI + Flask Bridge + ngrok
# Search: Playwright/Bing → Wikipedia → DDG | Content: Playwright → Jina → Crawl4AI → Trafilatura → BS4
# Paste this ENTIRE script in a single Colab cell and run.

import os,sys,time,json,subprocess,threading,queue,re,shutil,urllib.request,urllib.error,urllib.parse
from datetime import datetime,timezone
from flask import Flask,Response,request,jsonify,stream_with_context
from flask_cors import CORS
import requests as req_lib

# ── CONFIG ──
NGROK_TOKEN="YOUR_NGROK_AUTH_TOKEN_HERE"  # <-- Replace!
P_OL,P_C4,P_BR=11434,8020,5000; MODELS=["qwen3:8b"]
OL_ENV={"OLLAMA_KEEP_ALIVE":"-1","OLLAMA_NUM_PARALLEL":"4","OLLAMA_MAX_LOADED_MODELS":"3","OLLAMA_GPU_LAYERS":"999","OLLAMA_FLASH_ATTENTION":"1","OLLAMA_KV_CACHE_TYPE":"q8_0","OLLAMA_CONTEXT_LENGTH":"8192"}
OL=f"http://localhost:{P_OL}"; C4=f"http://localhost:{P_C4}"; JINA="https://r.jina.ai/"; MAXR=10
UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

# ── SETUP ──
def setup():
    print("📦 Setup..."); (shutil.which("zstd") or os.system("apt-get update -y && apt-get install -y zstd"))
    for p in ["flask flask-cors pyngrok","trafilatura","beautifulsoup4","requests","crawl4ai","aiohttp"]:
        try: __import__(p.split()[0].replace("-","_"))
        except: os.system(f"pip install -q {p}")
    try: from playwright.async_api import async_playwright
    except: os.system("pip install -q playwright")
    os.system("playwright install chromium 2>/dev/null || pip install -q playwright && playwright install chromium")
    os.system("playwright install-deps chromium 2>/dev/null || true")
    if not shutil.which("ollama"): os.system("curl -fsSL https://ollama.com/install.sh | sh"); os.environ["PATH"]+=":/usr/local/bin"
    print("✅ Ready")

def cleanup():
    for p in ["ollama","ngrok","crawl4ai","nebchat"]: os.system(f"pkill -9 -f {p} 2>/dev/null")
    for port in [P_OL,P_BR,P_C4]: os.system(f"fuser -k {port}/tcp 2>/dev/null")
    time.sleep(2)

def start_ollama():
    env=os.environ.copy(); env.update(OL_ENV); print("🚀 Ollama...")
    subprocess.Popen(["ollama","serve"],stdout=subprocess.DEVNULL,stderr=open("/content/ollama.log","w"),env=env)
    import requests as r
    for _ in range(30):
        try: r.get(f"http://127.0.0.1:{P_OL}/api/tags",timeout=2); print("✅ Ollama"); return
        except: time.sleep(1)
    raise RuntimeError("❌ Ollama failed")

def start_c4ai():
    print("🕷️ Crawl4AI...")
    with open("/content/c4ai_srv.py","w") as f: f.write('import asyncio\nfrom crawl4ai import AsyncWebCrawler,CrawlerRunConfig,BrowserConfig\nfrom aiohttp import web\nasync def h(r):\n try:\n  d=await r.json();u=d.get("url","")\n  if not u:return web.json_response({"error":"URL required"},status=400)\n  async with AsyncWebCrawler(config=BrowserConfig(headless=True)) as c:\n   res=await c.arun(url=u,config=CrawlerRunConfig(word_count_threshold=10,exclude_external_links=True,remove_overlay_elements=True,exclude_all_images=True,text_mode=True))\n   return web.json_response({"url":u,"content":{"markdown":res.markdown_v2.raw_markdown if hasattr(res,"markdown_v2") else res.markdown},"success":res.success,"status_code":res.status_code})\n except Exception as e:return web.json_response({"error":str(e)},status=500)\na=web.Application();a.router.add_post("/crawl",h);a.router.add_post("/crawl_stream",h);a.router.add_get("/health",lambda r:web.json_response({"status":"ok"}))\nif __name__=="__main__":web.run_app(a,host="0.0.0.0",port=8020)\n')
    subprocess.Popen(["python","/content/c4ai_srv.py"],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    import requests as r
    for _ in range(15):
        try:
            if r.get(f"http://127.0.0.1:{P_C4}/health",timeout=2).ok: print("✅ C4AI"); return
        except: time.sleep(1)
    print("⚠️ C4AI may need time...")

def ensure_models():
    import requests as r
    try: ex=[m["name"] for m in r.get(f"http://127.0.0.1:{P_OL}/api/tags").json().get("models",[])]
    except: ex=[]
    for m in MODELS:
        if not any(m in x for x in ex): print(f"⬇️ {m}..."); subprocess.run(["ollama","pull",m],check=True)
        else: print(f"✅ {m}")

def warmup():
    import requests as r; print("🔥 Warmup...")
    for m in MODELS:
        try: r.post(f"http://127.0.0.1:{P_OL}/api/generate",json={"model":m,"prompt":"hi","stream":False},timeout=240)
        except: pass
    print("✅ Warm!")

# ── FLASK ──
app=Flask(__name__); CORS(app,resources={r"/*":{"origins":"*"}})
_rc=0; _rl=threading.Lock()
@app.before_request
def _log():
    global _rc
    with _rl: _rc+=1
    print(f"[{datetime.now(timezone.utc).strftime('%H:%M:%S')}] #{_rc:05d} {request.method} {request.path}",flush=True)

# ── PLAYWRIGHT ──
_br=None; _bl=threading.Lock()
def _get_br():
    global _br
    if _br: return _br
    with _bl:
        if _br: return _br
        try:
            from playwright.sync_api import sync_playwright
            _br=sync_playwright().start().chromium.launch(headless=True,args=['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--disable-extensions','--single-process']); print("[PW] Up",flush=True)
        except Exception as e: print(f"[PW] Fail:{e}",flush=True); _br=None
    return _br

def _pw_bing(q,n=10):
    b=_get_br()
    if not b: return None; ctx=None
    try:
        ctx=b.new_context(user_agent=UA,viewport={'width':1280,'height':720},locale='en-US'); p=ctx.new_page()
        p.goto(f'https://www.bing.com/search?q={urllib.parse.quote(q)}&count={n}&setlang=en&cc=US',timeout=15000,wait_until='domcontentloaded'); p.wait_for_timeout(2000)
        if p.evaluate("()=>{const t=document.body.innerText||'';return t.includes('captcha')||t.includes('verify you are human')}"): ctx.close(); return None
        r=p.evaluate("(n)=>[...document.querySelectorAll('#b_results li.b_algo')].slice(0,n).map(li=>({title:li.querySelector('h2 a')?.textContent?.trim()||'',url:li.querySelector('h2 a')?.href||'',snippet:li.querySelector('.b_caption p,.b_lineclamp2,p')?.textContent?.trim()||''}))",n)
        ctx.close(); ctx=None
        if r:
            for x in r: x['snippet']=(x.get('snippet','') or '')[:500]
            print(f"[S] Bing:{len(r)}",flush=True); return r
    except: pass
    if ctx:
        try: ctx.close()
        except: pass
    return None

def _pw_read(url,mc=5000):
    b=_get_br()
    if not b: return None; ctx=None
    try:
        ctx=b.new_context(user_agent=UA,viewport={'width':1280,'height':720}); p=ctx.new_page()
        p.goto(url,timeout=20000,wait_until='domcontentloaded'); p.wait_for_timeout(2000)
        t=p.evaluate("(mc)=>{const s=['#mw-content-text','article','main','[role=\"main\"]','.post-content','.article-body','#content','.content'];let m;for(const sel of s){const e=document.querySelector(sel);if(e&&e.innerText.length>100){m=e;break}}if(!m)m=document.body;const c=m.cloneNode(true);c.querySelectorAll('script,style,nav,footer,header,aside,iframe,noscript,.ad,.cookie-banner,.popup,.modal,.sidebar').forEach(e=>e.remove());return(c.innerText||c.textContent||'').substring(0,mc)}",mc)
        ctx.close(); ctx=None
        if t and len(t.strip())>50: print(f"[X] PW:{len(t)}",flush=True); return t
    except: pass
    if ctx:
        try: ctx.close()
        except: pass
    return None

# ── SEARCH ──
FRE=re.compile(r'\b(who is|what is|define|meaning of|explain|history of|capital of|wikipedia)\b',re.I)
NRE=re.compile(r'\b(latest|recent|current|today|breaking|news|price of|stock|weather|forecast)\b',re.I)

def _s_wiki(q,n=5):
    try:
        r=req_lib.get("https://en.wikipedia.org/w/api.php",params={"action":"query","list":"search","srsearch":q,"srlimit":n,"format":"json","utf8":1},timeout=10,headers={"User-Agent":"NebChat/5.0"})
        if r.status_code!=200: return None
        hits=r.json().get("query",{}).get("search",[])
        if not hits: return None
        pids="|".join(str(h["pageid"]) for h in hits)
        er=req_lib.get("https://en.wikipedia.org/w/api.php",params={"action":"query","prop":"extracts","exintro":True,"explaintext":True,"exsentences":5,"pageids":pids,"format":"json","utf8":1},timeout=10,headers={"User-Agent":"NebChat/5.0"})
        ex={}
        if er.status_code==200:
            for pid,pd in er.json().get("query",{}).get("pages",{}).items(): ex[pid]=pd.get("extract","")
        out=[{"title":f"{h['title']} — Wikipedia","url":f"https://en.wikipedia.org/wiki/{urllib.parse.quote(h['title'].replace(' ','_'))}","snippet":re.sub(r'<[^>]+>','',ex.get(str(h["pageid"]),h.get("snippet","")))[:500]} for h in hits]
        if out: print(f"[S] Wiki:{len(out)}",flush=True)
        return out or None
    except: return None

def _s_ddg(q,n=8):
    try:
        from bs4 import BeautifulSoup
        r=req_lib.post("https://html.duckduckgo.com/html/",data={"q":q,"b":"","kl":"us-en"},headers={"User-Agent":UA},timeout=10)
        if r.status_code!=200: return None; soup=BeautifulSoup(r.text,"html.parser"); out=[]
        for d in soup.find_all("div",class_="result"):
            a=d.find("a",class_="result__a"); sn=d.find("a",class_="result__snippet")
            if not a: continue; h=a.get("href","")
            if "uddg=" in h: h=urllib.parse.parse_qs(urllib.parse.urlparse(h).query).get("uddg",[h])[0]
            if a.get_text(strip=True) and h: out.append({"title":a.get_text(strip=True),"url":h,"snippet":(sn.get_text(strip=True) if sn else "")[:500]})
            if len(out)>=n: break
        if out: print(f"[S] DDG:{len(out)}",flush=True)
        return out or None
    except: return None

def _t_search(q,n=10):
    qt="factual" if FRE.search(q) else ("news" if NRE.search(q) else "general"); print(f"[AG] Search({qt}):'{q[:50]}'",flush=True)
    if qt=="factual":
        r=_s_wiki(q,n)
        if r: return json.dumps(r)
    r=_pw_bing(q,n)
    if r: return json.dumps(r)
    if qt!="factual":
        r=_s_wiki(q,n)
        if r: return json.dumps(r)
    r=_s_ddg(q,n)
    if r: return json.dumps(r)
    return json.dumps({"error":"All search failed"})

# ── CONTENT ──
def _x_jina(url):
    try:
        h={"Accept":"text/markdown"}; k=os.environ.get("JINA_API_KEY","")
        if k: h["Authorization"]=f"Bearer {k}"
        c=req_lib.get(f"{JINA}{urllib.parse.quote(url,safe=':/?#[]@!$&()*+,;=')}",headers=h,timeout=20).text
        if c and len(c.strip())>50: print(f"[X] Jina:{len(c)}",flush=True); return c[:5000]
    except: pass

def _x_c4ai(url):
    try:
        r=req_lib.post(f"{C4}/crawl",json={"url":url},timeout=60)
        if r.ok:
            d=r.json(); x=d.get("content",d.get("result",{})); c=x.get("markdown",x.get("raw_markdown",json.dumps(x))) if isinstance(x,dict) else str(x)
            if c and len(c.strip())>50: print(f"[X] C4AI:{len(c)}",flush=True); return c[:5000]
    except: pass

def _x_traf(url):
    try:
        import trafilatura; d=trafilatura.fetch_url(url)
        if d:
            c=trafilatura.extract(d,output_format="markdown",include_links=True,include_tables=True,favor_precision=True)
            if c and len(c.strip())>50: print(f"[X] Traf:{len(c)}",flush=True); return c[:5000]
    except: pass

def _x_bs4(url):
    try:
        from bs4 import BeautifulSoup; r=req_lib.get(url,headers={"User-Agent":UA},timeout=15)
        if r.status_code!=200: return None; soup=BeautifulSoup(r.text,"html.parser")
        for t in soup.find_all(["script","style","nav","footer","header","aside","iframe","noscript"]): t.decompose()
        m=soup.find("main") or soup.find("article") or soup.find("div",class_=re.compile(r"content|article|post|entry",re.I))
        text="\n".join(l.strip() for l in (m or soup).get_text(separator="\n",strip=True).splitlines() if l.strip())
        if len(text)>50: print(f"[X] BS4:{len(text)}",flush=True); return text[:5000]
    except: pass

def _t_read(url):
    for fn in [lambda:_pw_read(url),lambda:_x_jina(url),lambda:_x_c4ai(url),lambda:_x_traf(url),lambda:_x_bs4(url)]:
        c=fn()
        if c: return c[:4000]
    return "Failed to read page."

def _exec(nm,args):
    if nm=="web_search": return _t_search(args.get("query",""))
    if nm=="read_page": return _t_read(args.get("url",""))
    return json.dumps({"error":f"Unknown:{nm}"})

# ── AGENTIC ──
TOOLS=[{"type":"function","function":{"name":"web_search","description":"Search the web for current info","parameters":{"type":"object","properties":{"query":{"type":"string"}},"required":["query"]}}},{"type":"function","function":{"name":"read_page","description":"Read full page content from URL","parameters":{"type":"object","properties":{"url":{"type":"string"}},"required":["url"]}}}]
SYSP="""You are an AI with web search and page reading tools. Search multiple times and read multiple pages as needed.
RULES: 1) For time-sensitive queries, MUST web_search FIRST 2) Use read_page for detailed content 3) Never say you can't browse 4) Cite sources 5) Keep searching until you have enough data"""

def _ollama(body):
    body["stream"]=False; r=urllib.request.Request(f"{OL}/v1/chat/completions",data=json.dumps(body).encode(),headers={"Content-Type":"application/json"},method="POST"); return json.loads(urllib.request.urlopen(r,timeout=300).read())

def _sse(cid,ts,m,d): return f"data: {json.dumps({'id':cid,'object':'chat.completion.chunk','created':ts,'model':m,'choices':[{'index':0,'delta':d,'finish_reason':None}]})}\n\n"

def _agentic(body,stream):
    msgs=list(body.get("messages",[])); model=body.get("model","qwen3:8b")
    if not any(m.get("role")=="system" for m in msgs): msgs.insert(0,{"role":"system","content":SYSP})
    else:
        for m in msgs:
            if m.get("role")=="system": m["content"]=SYSP+"\n\n"+m.get("content",""); break
    body["tools"]=TOOLS; body["tool_choice"]="auto"
    if not stream:
        resp=None
        for _ in range(MAXR):
            body["messages"]=msgs
            try: resp=_ollama(body)
            except Exception as e: return jsonify({"error":str(e)}),502
            msg=resp["choices"][0]["message"]
            if not msg.get("tool_calls"): break
            msgs.append(msg)
            for tc in msg["tool_calls"]: msgs.append({"role":"tool","tool_call_id":tc.get("id",""),"content":_exec(tc["function"]["name"],json.loads(tc["function"].get("arguments","{}")))})
        return jsonify(resp) if resp else (jsonify({"error":"No response"}),502)
    def gen():
        cid=f"chatcmpl-{int(time.time()*1000)}"; ts=int(time.time()); resp=None
        for rnd in range(MAXR):
            body["messages"]=msgs
            try: resp=_ollama(body)
            except Exception as e: yield _sse(cid,ts,model,{"content":f"\n\n⚠️ {e}"}); yield "data: [DONE]\n\n"; return
            msg=resp["choices"][0]["message"]; tcs=msg.get("tool_calls",[])
            if not tcs: break
            msgs.append(msg)
            for tc in tcs:
                fn=tc["function"]; nm=fn["name"]; args=json.loads(fn.get("arguments","{}")); tid=tc.get("id","")
                print(f"[AG] R{rnd+1}:{nm}({json.dumps(args)[:60]})",flush=True)
                if nm=="web_search": yield _sse(cid,ts,model,{"content":"","agentic_activity":{"type":"search","query":args.get("query",""),"round":rnd+1}})
                elif nm=="read_page": yield _sse(cid,ts,model,{"content":"","agentic_activity":{"type":"read","url":args.get("url",""),"round":rnd+1}})
                res=_exec(nm,args)
                if nm=="web_search":
                    try: yield _sse(cid,ts,model,{"content":"","agentic_activity":{"type":"search_results","count":len(json.loads(res)) if isinstance(json.loads(res),list) else 0,"round":rnd+1}})
                    except: pass
                elif nm=="read_page": yield _sse(cid,ts,model,{"content":"","agentic_activity":{"type":"read_done","chars":len(res),"round":rnd+1}})
                msgs.append({"role":"tool","tool_call_id":tid,"content":res})
        content=resp["choices"][0]["message"].get("content","") if resp else ""; thinking=resp["choices"][0]["message"].get("reasoning_content","") if resp else ""
        if thinking:
            for i in range(0,len(thinking),12): yield _sse(cid,ts,model,{"reasoning_content":thinking[i:i+12]})
        for i in range(0,len(content),8):
            d={"content":content[i:i+8]}
            if i==0: d["role"]="assistant"
            yield _sse(cid,ts,model,d)
        yield f"data: {json.dumps({'id':cid,'object':'chat.completion.chunk','created':ts,'model':model,'choices':[{'index':0,'delta':{},'finish_reason':'stop'}]})}\n\n"; yield "data: [DONE]\n\n"
    return Response(stream_with_context(gen()),content_type="text/event-stream",headers={"Cache-Control":"no-cache","X-Accel-Buffering":"no"})

# ── STREAM PROXY ──
def _proxy(url,method,hdrs,body):
    rq=urllib.request.Request(url,data=body,headers=hdrs,method=method)
    try: resp=urllib.request.urlopen(rq,timeout=300)
    except urllib.error.HTTPError as e:
        err=""
        try: err=e.read().decode("utf-8",errors="replace")
        except: pass
        return Response(err or e.reason,status=e.code,content_type="application/json")
    except urllib.error.URLError as e: return jsonify({"error":f"Unreachable:{e.reason}"}),502
    ct=resp.headers.get("Content-Type","application/octet-stream")
    if "text/event-stream" in ct:
        dq=queue.Queue(); done=threading.Event(); errs=[]
        def rd():
            try:
                while True:
                    c=resp.read(4096)
                    if not c: break
                    dq.put(c)
            except Exception as e: errs.append(str(e))
            finally:
                try: resp.close()
                except: pass
                done.set()
        threading.Thread(target=rd,daemon=True).start()
        def ka():
            last=time.time()
            while not done.is_set() or not dq.empty():
                try: yield dq.get(timeout=1); last=time.time()
                except queue.Empty:
                    if time.time()-last>15: yield b": keepalive\n\n"; last=time.time()
            if errs: yield f"data: {{'error':'{errs[0]}'}}\n\n".encode()
        return Response(stream_with_context(ka()),content_type=ct,headers={"Cache-Control":"no-cache","X-Accel-Buffering":"no"})
    def gn():
        try:
            while True:
                c=resp.read(4096)
                if not c: break
                yield c
        except: pass
        finally:
            try: resp.close()
            except: pass
    return Response(stream_with_context(gn()),content_type=ct)

# ── ROUTES ──
@app.route("/")
def idx(): return jsonify({"name":"NebChat","v":"5.0"})
@app.route("/v1/models",methods=["GET"])
def models():
    try: return jsonify({"object":"list","data":[{"id":m["name"],"object":"model","owned_by":"ollama"} for m in req_lib.get(f"{OL}/api/tags",timeout=5).json().get("models",[])]})
    except: return jsonify({"object":"list","data":[]})
@app.route("/v1/chat/completions",methods=["POST"])
def chat():
    body=request.get_json(force=True); stream=body.get("stream",False); msgs=body.get("messages",[])
    has_ag=any(m.get("role")=="system" and ("search" in m.get("content","").lower() or "agentic" in m.get("content","").lower()) for m in msgs)
    auto_kw=["search","look up","find","current","latest","price","news","weather","stock","today","recent","score"]
    if has_ag or any(kw in str(msgs[-1].get("content","")).lower() for kw in auto_kw): return _agentic(body,stream)
    if stream:
        qs=request.query_string.decode("utf-8"); return _proxy(f"{OL}/v1/chat/completions"+(f"?{qs}" if qs else ""),"POST",{k:v for k,v in request.headers if k.lower()!="host"},request.get_data())
    try: return jsonify(_ollama(body))
    except Exception as e: return jsonify({"error":str(e)}),502
@app.route("/v1/<path:path>",methods=["GET","POST","PUT","DELETE","PATCH"])
def pv1(path):
    qs=request.query_string.decode("utf-8"); h={k:v for k,v in request.headers if k.lower()!="host"}; h["Content-Type"]="application/json"
    return _proxy(f"{OL}/v1/{path}"+(f"?{qs}" if qs else ""),request.method,h,request.get_data())
@app.route("/api/<path:path>",methods=["GET","POST","PUT","DELETE","PATCH"])
def papi(path):
    qs=request.query_string.decode("utf-8"); h={k:v for k,v in request.headers if k.lower()!="host"}; h["Content-Type"]="application/json"
    return _proxy(f"{OL}/api/{path}"+(f"?{qs}" if qs else ""),request.method,h,request.get_data())
@app.route("/search",methods=["GET"])
def search():
    q=request.args.get("q","")
    return jsonify({"query":q,"results":json.loads(_t_search(q))}) if q else (jsonify({"error":"Missing ?q="}),400)
@app.route("/crawl",methods=["POST"])
def crawl():
    url=request.get_json(force=True).get("url","")
    return jsonify({"url":url,"content":_t_read(url)}) if url else (jsonify({"error":"Missing url"}),400)
@app.route("/health",methods=["GET"])
def health():
    ol=c4=pw=False
    try: ol=req_lib.get(f"{OL}/api/tags",timeout=3).ok
    except: pass
    try: c4=req_lib.get(f"{C4}/health",timeout=3).ok
    except: pass
    pw=_get_br() is not None
    return jsonify({"status":"ok" if ol else "degraded","ollama":ol,"crawl4ai":c4,"playwright":pw})
@app.errorhandler(404)
@app.errorhandler(500)
def _err(e): return jsonify({"error":str(e)}),getattr(e,'code',500)

# ── MAIN ──
def run():
    from pyngrok import ngrok; ngrok.set_auth_token(NGROK_TOKEN); url=ngrok.connect(P_BR,bind_tls=True).public_url
    print(f"\n{'='*60}\n🚀 NebChat LIVE!\n📡 {url}\n{'='*60}\n")
    with open("/content/nebchat_url.txt","w") as f: f.write(url)
    app.run(host="0.0.0.0",port=P_BR,threaded=True)

def monitor(iv=120):
    import requests as r
    while True:
        time.sleep(iv)
        try: print(f"[MON] {r.get(f'http://127.0.0.1:{P_BR}/health',timeout=5).json()}",flush=True)
        except: print("[MON] Down!",flush=True)

if __name__=="__main__":
    setup(); cleanup(); start_ollama(); start_c4ai(); ensure_models(); warmup()
    threading.Thread(target=monitor,daemon=True).start(); run()
