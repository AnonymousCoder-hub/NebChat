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

    // If agentic mode is on, skip injecting search results — the bridge handles it
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
