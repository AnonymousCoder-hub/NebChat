import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const baseUrl = searchParams.get("baseUrl") || "";
    const apiKey = searchParams.get("apiKey") || "";

    if (!baseUrl) {
      return NextResponse.json(
        { error: "Base URL is required" },
        { status: 400 }
      );
    }

    const normalizedUrl = baseUrl.replace(/\/+$/, "");
    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (apiKey && apiKey !== "ollama" && apiKey !== "none") {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    // Try /v1/models first (OpenAI-compatible)
    const models = await tryFetchModels(
      `${normalizedUrl}/v1/models`,
      headers
    );

    if (models) {
      return NextResponse.json(models);
    }

    // Fallback: try /models (some providers)
    const modelsFallback = await tryFetchModels(
      `${normalizedUrl}/models`,
      headers
    );

    if (modelsFallback) {
      return NextResponse.json(modelsFallback);
    }

    return NextResponse.json(
      { error: "Could not fetch models from the provided URL" },
      { status: 400 }
    );
  } catch (error) {
    console.error("Models API error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function tryFetchModels(
  url: string,
  headers: Record<string, string>
): Promise<unknown> {
  try {
    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) return null;

    const data = await response.json();

    // Normalize different response formats
    // OpenAI format: { data: [...] }
    // Ollama format: { models: [...] }
    // Some: direct array
    if (Array.isArray(data)) {
      return { object: "list", data: normalizeModels(data) };
    }
    if (data.data && Array.isArray(data.data)) {
      return { object: "list", data: normalizeModels(data.data) };
    }
    if (data.models && Array.isArray(data.models)) {
      return {
        object: "list",
        data: normalizeModels(
          data.models.map(
            (m: { id?: string; name?: string; model?: string; owned_by?: string; provider?: string }) => ({
              id: m.id || m.name || m.model,
              object: "model",
              created: Date.now(),
              owned_by: m.owned_by || m.provider || "unknown",
            })
          )
        ),
      };
    }

    return data;
  } catch {
    return null;
  }
}

function normalizeModels(
  models: { id?: string; name?: string; object?: string; created?: number; owned_by?: string }[]
) {
  return models.map((m) => ({
    id: m.id || m.name || "unknown",
    object: m.object || "model",
    created: m.created || Date.now(),
    owned_by: m.owned_by || "unknown",
  }));
}
