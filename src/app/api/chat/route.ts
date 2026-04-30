import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      messages,
      model,
      baseUrl,
      apiKey,
      stream = true,
      temperature,
      max_tokens,
      thinkingEnabled,
      searchResults,
      systemPrompt,
      agentic,
    } = body;

    if (!baseUrl || !model) {
      return NextResponse.json(
        { error: "Base URL and model are required" },
        { status: 400 }
      );
    }

    // Build messages array with proper context
    const processedMessages: { role: string; content: string }[] = [];

    // Add system prompt if provided
    if (systemPrompt) {
      processedMessages.push({ role: "system", content: systemPrompt });
    }

    // Process history messages
    for (const msg of messages) {
      // Skip system messages from history (we handle system prompt separately)
      if (msg.role === "system") continue;

      let content = msg.content || "";

      // Strip <think...> tags from history if thinking is disabled
      if (!thinkingEnabled) {
        content = content.replace(/<think[^>]*>[\s\S]*?<\/think>/g, "").trim();
      }

      if (content) {
        processedMessages.push({ role: msg.role, content });
      }
    }

    // If agentic mode is on, inject a system prompt telling the AI about its search capabilities
    // This is CRITICAL — without it, the AI doesn't know it can search and will say "I can't access the internet"
    if (agentic) {
      const agenticSystemPrompt = `You are an AI assistant with web search and page reading capabilities. You have access to the following tools:
- web_search: Search the web for current, up-to-date information. Returns titles, URLs, and snippets.
- read_page: Read the full content of a web page as markdown. Use for detailed info from URLs found via search.

CRITICAL RULES:
1. When the user asks about current events, stock prices, weather, news, recent data, or ANY time-sensitive information, you MUST use the web_search tool FIRST before responding. Do NOT say you cannot access the internet — you CAN and MUST search.
2. When the user asks "what is the price of X", "what happened today", "latest news about Y", or similar real-time queries, ALWAYS call web_search immediately.
3. After searching, if you need more detailed information from a specific URL, use the read_page tool to get the full content.
4. Only respond without searching if the question is about general knowledge, math, coding, or topics that don't require current data.
5. Never say "I don't have access to real-time data" or "I can't browse the internet" — you CAN search using your tools.
6. Always cite your sources by including URLs from the search results in your response.`;
      processedMessages.unshift({ role: "system", content: agenticSystemPrompt });
    }

    // If NOT agentic, inject search results as context (frontend-side search)
    if (!agentic && searchResults && searchResults.length > 0) {
      const lastUserIdx = processedMessages.map(m => m.role).lastIndexOf("user");
      if (lastUserIdx !== -1) {
        const searchContext = buildSearchContext(searchResults);
        processedMessages.splice(lastUserIdx, 0, {
          role: "system",
          content: searchContext,
        });
      }
    }

    // Normalize base URL
    let normalizedUrl = baseUrl.replace(/\/+$/, "");

    // Build request body for OpenAI-compatible API
    const requestBody: Record<string, unknown> = {
      model,
      messages: processedMessages,
      stream,
    };

    if (temperature !== undefined) requestBody.temperature = temperature;
    if (max_tokens !== undefined) requestBody.max_tokens = max_tokens;

    // Add reasoning_effort parameter
    // When thinking is enabled: "high" for deep reasoning
    // When thinking is disabled: "none" to skip thinking entirely
    if (thinkingEnabled) {
      requestBody.reasoning_effort = "high";
    } else {
      requestBody.reasoning_effort = "none";
    }

    // Pass agentic flag for the bridge to handle tool calling
    if (agentic) {
      requestBody.agentic = true;
    }

    // Determine the API endpoint
    const endpoint = `${normalizedUrl}/v1/chat/completions`;

    // Set up headers
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (apiKey && apiKey !== "ollama" && apiKey !== "none") {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    if (stream) {
      // Stream the response
      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(300000), // 5 min timeout for long responses
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        return NextResponse.json(
          { error: `LLM API error: ${response.status} - ${errorText.slice(0, 500)}` },
          { status: response.status }
        );
      }

      // Stream the SSE response through
      const stream = new ReadableStream({
        async start(controller) {
          const reader = response.body?.getReader();
          if (!reader) {
            controller.close();
            return;
          }

          const decoder = new TextDecoder();
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              const chunk = decoder.decode(value, { stream: true });
              controller.enqueue(new TextEncoder().encode(chunk));
            }
          } catch (err) {
            // Client disconnected - that's fine
            console.error("Stream error:", err);
          } finally {
            controller.close();
            reader.releaseLock();
          }
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
        },
      });
    } else {
      // Non-streaming request
      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(300000),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        return NextResponse.json(
          { error: `LLM API error: ${response.status} - ${errorText.slice(0, 500)}` },
          { status: response.status }
        );
      }

      const data = await response.json();
      return NextResponse.json(data);
    }
  } catch (error) {
    console.error("Chat API error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Build a search context message that gives the AI full awareness of search results
 */
function buildSearchContext(
  results: { title: string; url: string; snippet: string; content?: string }[]
): string {
  let context = `[WEB SEARCH RESULTS]\nThe following are web search results relevant to the user's query. Use this information to provide an accurate, up-to-date response. Cite sources by referencing the URL when using specific information.\n\n`;

  results.forEach((result, i) => {
    context += `--- Source ${i + 1}: ${result.title} ---\n`;
    context += `URL: ${result.url}\n`;
    if (result.content) {
      const maxContent = 2000;
      context += result.content.length > maxContent
        ? result.content.slice(0, maxContent) + "..."
        : result.content;
    } else {
      context += result.snippet;
    }
    context += "\n\n";
  });

  context += `---\nUse the above search results to inform your response. Always cite the URL when referencing specific information from the sources. Do not mention "search results" or "the search" - just naturally incorporate the information.`;
  return context;
}
