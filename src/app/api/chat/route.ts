import { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      messages,
      model,
      baseUrl,
      apiKey,
      stream = true,
      temperature = 0.7,
      max_tokens = 4096,
      thinkingEnabled = true,
      searchResults,
      searchEnabled = false,
    } = body;

    if (!baseUrl || !apiKey || !model) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: baseUrl, apiKey, model" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Normalize base URL
    const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
    const url = `${normalizedBaseUrl}/v1/chat/completions`;

    // Build messages array - inject search results if provided
    const processedMessages = [...messages];

    if (searchResults && searchResults.length > 0) {
      // Inject search results as a system context message BEFORE the last user message
      // This keeps the conversation clean and doesn't pollute user messages
      const searchContext = searchResults
        .slice(0, 10) // Max 10 results to keep context manageable
        .map((r: { title: string; url: string; snippet: string; content?: string }, i: number) => {
          // If we have page content, include a condensed version
          if (r.content && r.content.length > 100) {
            // Take first 1500 chars of content (reduced from 8000 for chat mode)
            const condensed = r.content.length > 1500 ? r.content.slice(0, 1500) + "..." : r.content;
            return `[${i + 1}] ${r.title}\nURL: ${r.url}\nContent: ${condensed}`;
          }
          return `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.snippet}`;
        })
        .join("\n\n");

      // Find the last user message and prepend search context
      const lastUserIdx = processedMessages.map((m: { role: string }) => m.role).lastIndexOf("user");
      if (lastUserIdx !== -1) {
        const originalContent = processedMessages[lastUserIdx].content;
        processedMessages[lastUserIdx] = {
          ...processedMessages[lastUserIdx],
          content: `I searched the web for you. Here are the relevant results:\n\n${searchContext}\n\n---\n\nBased on the above web search results, provide a comprehensive and accurate answer. Cite sources by number [1], [2], etc. when referencing information. If the search results don't fully answer the question, provide what you can and note any gaps.\n\nUser's question: ${originalContent}`,
        };
      }
    }

    // Build payload with thinking control
    const payload: Record<string, unknown> = {
      model,
      messages: processedMessages,
      stream,
      temperature,
      max_tokens,
    };

    // Thinking control via API parameters:
    //
    // `reasoning_effort`: for Ollama's OpenAI-compatible endpoint (/v1/chat/completions)
    //   - "none" = disable thinking, "low"/"medium"/"high" = enable with effort level
    //   - Works across all models (qwen3, gemma4, deepseek-r1, etc.)
    //
    // `think`: for Ollama's native API (/api/chat)
    //   - true/false toggle for thinking
    //
    // Both params are safely ignored by non-Ollama providers (OpenAI, Groq, etc.)
    //
    // NOTE: We do NOT use /no_think tags in the prompt because they are
    // qwen3-specific — other models like gemma4 treat them as literal text
    // and respond to them, which breaks the conversation.
    if (!thinkingEnabled) {
      // Strip any <think...</think...> tags from message history so the model
      // doesn't see old thinking and continue the pattern
      payload.messages = processedMessages.map((m: { role: string; content: string }) => ({
        role: m.role,
        content: m.content.replace(/<think[\s\/]*>[\s\S]*?<\/think>\s*/g, ""),
      }));

      payload.reasoning_effort = "none";
      payload.think = false;
    } else {
      payload.reasoning_effort = "high";
      payload.think = true;
    }

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage: string;
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.error?.message || errorJson.message || errorText;
      } catch {
        errorMessage = errorText;
      }
      return new Response(
        JSON.stringify({ error: errorMessage }),
        { status: response.status, headers: { "Content-Type": "application/json" } }
      );
    }

    if (stream) {
      const reader = response.body?.getReader();
      if (!reader) {
        return new Response(
          JSON.stringify({ error: "No response body" }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }

      const stream = new ReadableStream({
        async start(controller) {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                controller.close();
                break;
              }
              controller.enqueue(value);
            }
          } catch (error) {
            controller.error(error);
          }
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    } else {
      const data = await response.json();
      return new Response(JSON.stringify(data), {
        headers: { "Content-Type": "application/json" },
      });
    }
  } catch (error) {
    console.error("Chat API error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
