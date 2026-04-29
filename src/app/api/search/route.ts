import { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { query, provider, maxResults = 5, fetchContent = false, contentPages = 3, pageReaderUrl } = body;

    if (!query || !provider) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: query, provider" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const { type, baseUrl, apiKey, cxId } = provider;

    let results: { title: string; url: string; snippet: string; content?: string }[] = [];

    switch (type) {
      case "duckduckgo": {
        if (!baseUrl) {
          return new Response(
            JSON.stringify({ error: "DuckDuckGo requires a base URL (your Colab proxy URL)" }),
            { status: 400, headers: { "Content-Type": "application/json" } }
          );
        }
        // DuckDuckGo search via the Colab unified proxy
        const searchUrl = `${baseUrl.replace(/\/+$/, "")}/search?q=${encodeURIComponent(query)}&max_results=${maxResults}`;
        
        const response = await fetch(searchUrl, {
          headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
          signal: AbortSignal.timeout(15000),
        });
        
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: `DuckDuckGo proxy returned ${response.status}` }));
          throw new Error(errorData.error || `DuckDuckGo proxy returned ${response.status}`);
        }
        const data = await response.json();
        results = (data.results || []).slice(0, maxResults).map((r: Record<string, unknown>) => ({
          title: String(r.title || ""),
          url: String(r.url || ""),
          snippet: String(r.content || ""),
        }));
        break;
      }

      case "searxng": {
        if (!baseUrl) {
          return new Response(
            JSON.stringify({ error: "SearXNG requires a base URL" }),
            { status: 400, headers: { "Content-Type": "application/json" } }
          );
        }
        const searchUrl = `${baseUrl.replace(/\/+$/, "")}/search?q=${encodeURIComponent(query)}&format=json&categories=general`;
        
        // Retry logic for SearXNG (503 = service not ready yet)
        let response: Response | null = null;
        const maxRetries = 3;
        for (let attempt = 0; attempt < maxRetries; attempt++) {
          try {
            response = await fetch(searchUrl, {
              headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
              signal: AbortSignal.timeout(15000),
            });
            if (response.ok) break;
            if (response.status === 503 && attempt < maxRetries - 1) {
              // SearXNG not ready, wait and retry
              await new Promise(resolve => setTimeout(resolve, 2000 * (attempt + 1)));
              continue;
            }
          } catch (fetchError) {
            if (attempt < maxRetries - 1) {
              await new Promise(resolve => setTimeout(resolve, 2000 * (attempt + 1)));
              continue;
            }
            throw fetchError;
          }
        }
        
        if (!response || !response.ok) {
          const status = response?.status || 0;
          if (status === 503) {
            throw new Error("SearXNG is unavailable (503). Make sure SearXNG Docker container is running in your Colab. Check the Colab output for errors.");
          }
          throw new Error(`SearXNG returned ${status}`);
        }
        const data = await response.json();
        results = (data.results || []).slice(0, maxResults).map((r: Record<string, unknown>) => ({
          title: String(r.title || ""),
          url: String(r.url || ""),
          snippet: String(r.content || ""),
        }));
        break;
      }

      case "brave": {
        if (!apiKey) {
          return new Response(
            JSON.stringify({ error: "Brave Search requires an API key" }),
            { status: 400, headers: { "Content-Type": "application/json" } }
          );
        }
        const response = await fetch(
          `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${maxResults}`,
          {
            headers: {
              "X-Subscription-Token": apiKey,
              Accept: "application/json",
            },
            signal: AbortSignal.timeout(15000),
          }
        );
        if (!response.ok) {
          throw new Error(`Brave Search returned ${response.status}`);
        }
        const data = await response.json();
        results = (data.web?.results || []).map((r: Record<string, unknown>) => ({
          title: String(r.title || ""),
          url: String(r.url || ""),
          snippet: String(r.description || ""),
        }));
        break;
      }

      case "serper": {
        if (!apiKey) {
          return new Response(
            JSON.stringify({ error: "Serper requires an API key" }),
            { status: 400, headers: { "Content-Type": "application/json" } }
          );
        }
        const response = await fetch("https://google.serper.dev/search", {
          method: "POST",
          headers: {
            "X-API-KEY": apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ q: query, num: maxResults }),
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) {
          throw new Error(`Serper returned ${response.status}`);
        }
        const data = await response.json();
        results = (data.organic || []).map((r: Record<string, unknown>) => ({
          title: String(r.title || ""),
          url: String(r.link || ""),
          snippet: String(r.snippet || ""),
        }));
        break;
      }

      case "tavily": {
        if (!apiKey) {
          return new Response(
            JSON.stringify({ error: "Tavily requires an API key" }),
            { status: 400, headers: { "Content-Type": "application/json" } }
          );
        }
        const response = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query,
            api_key: apiKey,
            max_results: maxResults,
            include_answer: false,
          }),
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) {
          throw new Error(`Tavily returned ${response.status}`);
        }
        const data = await response.json();
        results = (data.results || []).map((r: Record<string, unknown>) => ({
          title: String(r.title || ""),
          url: String(r.url || ""),
          snippet: String(r.content || ""),
        }));
        break;
      }

      case "google_cse": {
        if (!apiKey || !cxId) {
          return new Response(
            JSON.stringify({ error: "Google CSE requires an API key and CX ID" }),
            { status: 400, headers: { "Content-Type": "application/json" } }
          );
        }
        const response = await fetch(
          `https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(query)}&key=${apiKey}&cx=${cxId}&num=${maxResults}`,
          { signal: AbortSignal.timeout(15000) }
        );
        if (!response.ok) {
          throw new Error(`Google CSE returned ${response.status}`);
        }
        const data = await response.json();
        results = (data.items || []).map((r: Record<string, unknown>) => ({
          title: String(r.title || ""),
          url: String(r.link || ""),
          snippet: String(r.snippet || ""),
        }));
        break;
      }

      default:
        return new Response(
          JSON.stringify({ error: `Unknown search provider type: ${type}` }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
    }

    // --- FETCH FULL PAGE CONTENT ---
    // After getting search results, read the top pages
    // If Crawl4AI is configured, use it; otherwise fall back to Jina Reader
    if (fetchContent && results.length > 0) {
      const pagesToFetch = Math.min(contentPages, results.length, 3); // Cap at 3 pages max
      const fetchPromises = results.slice(0, pagesToFetch).map(async (result, i) => {
        try {
          if (pageReaderUrl) {
            // Use Crawl4AI
            const crawlUrl = `${pageReaderUrl.replace(/\/+$/, "")}/crawl`;
            const crawlResponse = await fetch(crawlUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ url: result.url }),
              signal: AbortSignal.timeout(15000),
            });
            if (crawlResponse.ok) {
              const crawlData = await crawlResponse.json();
              const markdown = crawlData?.content?.markdown || "";
              if (markdown) {
                // Truncate to 2000 chars per page to keep context manageable
                const truncated = markdown.length > 2000 ? markdown.slice(0, 2000) + "\n...(truncated)" : markdown;
                results[i] = { ...result, content: truncated };
                return;
              }
            }
            // Crawl4AI failed, fall through to Jina Reader
          }
          // Fallback: Jina Reader (https://r.jina.ai) — free, no API key
          const jinaUrl = `https://r.jina.ai/${encodeURIComponent(result.url)}`;
          const pageResponse = await fetch(jinaUrl, {
            headers: {
              Accept: "text/plain",
            },
            signal: AbortSignal.timeout(10000),
          });
          if (pageResponse.ok) {
            const text = await pageResponse.text();
            // Truncate to 2000 chars per page
            const truncated = text.length > 2000 ? text.slice(0, 2000) + "\n...(truncated)" : text;
            results[i] = { ...result, content: truncated };
          }
          // If fetch fails, just keep the snippet — don't block other results
        } catch {
          // Page read failed, keep snippet only
        }
      });

      await Promise.allSettled(fetchPromises);
    }

    return new Response(
      JSON.stringify({ results }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Search API error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Internal server error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
