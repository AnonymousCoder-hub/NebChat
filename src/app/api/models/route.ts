import { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { baseUrl, apiKey } = body;

    if (!baseUrl) {
      return new Response(
        JSON.stringify({ error: "Missing required field: baseUrl" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Normalize base URL
    const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
    
    // Try different model endpoints
    const endpoints = [
      `${normalizedBaseUrl}/v1/models`,
      `${normalizedBaseUrl}/models`,
    ];

    let lastError: string | null = null;

    for (const url of endpoints) {
      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        
        if (apiKey) {
          headers["Authorization"] = `Bearer ${apiKey}`;
        }

        const response = await fetch(url, {
          method: "GET",
          headers,
          signal: AbortSignal.timeout(10000), // 10 second timeout
        });

        if (response.ok) {
          const data = await response.json();
          
          // Handle different response formats
          let models = [];
          if (Array.isArray(data)) {
            models = data;
          } else if (data.data && Array.isArray(data.data)) {
            models = data.data;
          } else if (data.models && Array.isArray(data.models)) {
            models = data.models;
          }

          // Normalize model format
          const normalizedModels = models.map((m: Record<string, unknown>) => ({
            id: m.id || m.name || m.model || "",
            name: m.name || m.id || m.model || "",
            object: m.object || "model",
            owned_by: m.owned_by || m.owner || "",
          })).filter((m: { id: string }) => m.id);

          return new Response(
            JSON.stringify({ data: normalizedModels }),
            { headers: { "Content-Type": "application/json" } }
          );
        } else {
          const errorText = await response.text().catch(() => "Unknown error");
          lastError = `HTTP ${response.status}: ${errorText}`;
        }
      } catch (err) {
        lastError = err instanceof Error ? err.message : "Unknown error";
        continue;
      }
    }

    return new Response(
      JSON.stringify({ error: lastError || "Could not fetch models from any endpoint" }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Models API error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
