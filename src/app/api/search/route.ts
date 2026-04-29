import { NextRequest, NextResponse } from "next/server";

// ============================================================
// Search API — Multi-provider search with page reading
// ============================================================

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const query = searchParams.get("q");
    const providerType = searchParams.get("type") || "duckduckgo";
    const providerUrl = searchParams.get("url") || "";
    const apiKey = searchParams.get("apiKey") || "";
    const cxId = searchParams.get("cxId") || "";
    const maxResults = parseInt(searchParams.get("maxResults") || "8");
    const pageReaderUrl = searchParams.get("pageReaderUrl") || "";
    const readPages = searchParams.get("readPages") === "true";

    if (!query) {
      return NextResponse.json(
        { error: "Query parameter 'q' is required" },
        { status: 400 }
      );
    }

    let results: { title: string; url: string; snippet: string; content?: string }[] = [];

    switch (providerType) {
      case "duckduckgo":
        results = await searchDuckDuckGo(query, providerUrl, maxResults);
        break;
      case "searxng":
        results = await searchSearXNG(query, providerUrl, maxResults);
        break;
      case "brave":
        results = await searchBrave(query, apiKey, maxResults);
        break;
      case "serper":
        results = await searchSerper(query, apiKey, maxResults);
        break;
      case "tavily":
        results = await searchTavily(query, apiKey, maxResults);
        break;
      case "google_cse":
        results = await searchGoogleCSE(query, apiKey, cxId, maxResults);
        break;
      default:
        return NextResponse.json(
          { error: `Unknown search provider type: ${providerType}` },
          { status: 400 }
        );
    }

    // Read top pages if requested
    if (readPages && pageReaderUrl && results.length > 0) {
      const topResults = results.slice(0, 3);
      const readPromises = topResults.map(async (result) => {
        try {
          const pageContent = await readPage(result.url, pageReaderUrl);
          if (pageContent) {
            result.content = pageContent.slice(0, 3000);
          }
        } catch {
          // Page reading failed, that's okay
        }
        return result;
      });

      await Promise.allSettled(readPromises);
    }

    return NextResponse.json({ results, query, provider: providerType });
  } catch (error) {
    console.error("Search API error:", error);
    const message = error instanceof Error ? error.message : "Search failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// --- DuckDuckGo via Colab proxy (Jina AI + DDG fallback) ---
async function searchDuckDuckGo(
  query: string,
  proxyUrl: string,
  maxResults: number
) {
  if (!proxyUrl) {
    throw new Error("DuckDuckGo search requires a proxy URL (Colab bridge URL)");
  }

  const url = `${proxyUrl.replace(/\/+$/, "")}/search?q=${encodeURIComponent(query)}&max_results=${maxResults}`;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`Search proxy error: ${response.status}`);
  }

  const data = await response.json();
  return (data.results || []).map(
    (r: { title?: string; url?: string; content?: string; href?: string; body?: string }) => ({
      title: r.title || "",
      url: r.url || r.href || "",
      snippet: r.content || r.body || "",
    })
  );
}

// --- SearXNG ---
async function searchSearXNG(
  query: string,
  baseUrl: string,
  maxResults: number
) {
  if (!baseUrl) {
    throw new Error("SearXNG requires a base URL");
  }

  const url = `${baseUrl.replace(/\/+$/, "")}/search?q=${encodeURIComponent(query)}&format=json&categories=general`;

  // Retry logic for SearXNG (may return 503 if not ready)
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(10000),
      });

      if (response.status === 503) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }

      if (!response.ok) {
        throw new Error(`SearXNG error: ${response.status}`);
      }

      const data = await response.json();
      return (data.results || [])
        .slice(0, maxResults)
        .map(
          (r: { title?: string; url?: string; content?: string; snippet?: string }) => ({
            title: r.title || "",
            url: r.url || "",
            snippet: r.content || r.snippet || "",
          })
        );
    } catch (err) {
      lastError = err instanceof Error ? err : new Error("Unknown error");
      if (attempt < 2) await new Promise((r) => setTimeout(r, 2000));
    }
  }

  throw lastError || new Error("SearXNG search failed after retries");
}

// --- Brave Search ---
async function searchBrave(query: string, apiKey: string, maxResults: number) {
  if (!apiKey) throw new Error("Brave Search requires an API key");

  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${maxResults}`;
  const response = await fetch(url, {
    headers: {
      "X-Subscription-Token": apiKey,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) throw new Error(`Brave Search error: ${response.status}`);

  const data = await response.json();
  return (data.web?.results || []).map(
    (r: { title?: string; url?: string; description?: string }) => ({
      title: r.title || "",
      url: r.url || "",
      snippet: r.description || "",
    })
  );
}

// --- Serper.dev ---
async function searchSerper(query: string, apiKey: string, maxResults: number) {
  if (!apiKey) throw new Error("Serper requires an API key");

  const response = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ q: query, num: maxResults }),
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) throw new Error(`Serper error: ${response.status}`);

  const data = await response.json();
  return (data.organic || []).map(
    (r: { title?: string; link?: string; snippet?: string }) => ({
      title: r.title || "",
      url: r.link || "",
      snippet: r.snippet || "",
    })
  );
}

// --- Tavily ---
async function searchTavily(query: string, apiKey: string, maxResults: number) {
  if (!apiKey) throw new Error("Tavily requires an API key");

  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: maxResults,
      include_answer: false,
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) throw new Error(`Tavily error: ${response.status}`);

  const data = await response.json();
  return (data.results || []).map(
    (r: { title?: string; url?: string; content?: string }) => ({
      title: r.title || "",
      url: r.url || "",
      snippet: r.content || "",
    })
  );
}

// --- Google Custom Search ---
async function searchGoogleCSE(
  query: string,
  apiKey: string,
  cxId: string,
  maxResults: number
) {
  if (!apiKey || !cxId)
    throw new Error("Google CSE requires API key and CX ID");

  const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cxId}&q=${encodeURIComponent(query)}&num=${maxResults}`;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) throw new Error(`Google CSE error: ${response.status}`);

  const data = await response.json();
  return (data.items || []).map(
    (r: { title?: string; link?: string; snippet?: string }) => ({
      title: r.title || "",
      url: r.link || "",
      snippet: r.snippet || "",
    })
  );
}

// --- Page Reading (Crawl4AI / Jina Reader) ---
async function readPage(
  targetUrl: string,
  pageReaderUrl: string
): Promise<string | null> {
  try {
    const crawlUrl = `${pageReaderUrl.replace(/\/+$/, "")}/crawl`;
    const response = await fetch(crawlUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: targetUrl }),
      signal: AbortSignal.timeout(20000),
    });

    if (!response.ok) return null;

    const data = await response.json();
    // Extract markdown content from Crawl4AI or Jina Reader response
    if (data.content?.markdown) {
      return data.content.markdown.slice(0, 5000);
    }
    if (data.success && data.content) {
      return typeof data.content === "string"
        ? data.content.slice(0, 5000)
        : JSON.stringify(data.content).slice(0, 5000);
    }
    return null;
  } catch {
    return null;
  }
}
