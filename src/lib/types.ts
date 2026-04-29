export interface APIProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  models: ModelInfo[];
  addedAt: number;
  isEnabled: boolean;
}

export interface ModelInfo {
  id: string;
  name: string;
  providerId: string;
  object?: string;
  owned_by?: string;
}

export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  thinking?: string;
  timestamp: number;
  model?: string;
  providerId?: string;
  searchResults?: SearchResult[];
  tokenStats?: TokenStats;
}

export interface Conversation {
  id: string;
  title: string;
  modelId: string;
  providerId: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
  thinkingEnabled?: boolean;
  searchEnabled?: boolean;
  type?: "chat" | "swarm";
  swarmConfig?: SwarmConfig;
  swarmOutput?: string;
  swarmSteps?: SwarmStep[];
}

export type AppView = "home" | "chat" | "settings" | "research";

export interface ChatRequestBody {
  messages: { role: string; content: string }[];
  model: string;
  baseUrl: string;
  apiKey: string;
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  thinkingEnabled?: boolean;
  searchResults?: SearchResult[];
}

export interface ModelsResponse {
  object: string;
  data: Array<{
    id: string;
    object: string;
    created: number;
    owned_by: string;
  }>;
}

// --- Search Types ---
export type SearchProviderType = "duckduckgo" | "searxng" | "brave" | "serper" | "tavily" | "google_cse";

export interface SearchProvider {
  id: string;
  name: string;
  type: SearchProviderType;
  baseUrl?: string; // For SearXNG
  apiKey?: string;
  cxId?: string; // For Google CSE
  isEnabled: boolean;
  addedAt: number;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  content?: string; // Full page content (fetched via page reader)
}

export interface SearchRequest {
  query: string;
  provider: SearchProvider;
  maxResults?: number;
}

// --- Token Stats ---
export interface TokenStats {
  totalTokens: number;
  totalTimeMs: number;
  tokensPerSecond: number;
  thinkingTokens?: number;
}

// --- Agent / Research Types ---
export type AgentRole = "manager" | "researcher" | "analyst" | "writer" | "coder" | "custom";

export interface AgentConfig {
  id: string;
  name: string;
  role: AgentRole;
  systemPrompt: string;
  modelId: string;
  providerId: string;
  searchEnabled: boolean;
  searchLimit: number;
  priority: number; // Higher = processes later (closer to final output)
  thinkingEnabled: boolean; // Per-agent thinking toggle
  maxIterations: number; // Max agentic loop iterations for this agent (0 = unlimited)
}

export type AgentStatus = "idle" | "thinking" | "searching" | "reading" | "writing" | "done" | "error";

export interface AgentState {
  config: AgentConfig;
  status: AgentStatus;
  currentThinking: string;
  currentOutput: string;
  searchQueries: string[];
  searchResults: SearchResult[];
  roundsCompleted: number;
  tokenStats?: TokenStats;
}

export type ResearchStatus = "idle" | "running" | "paused" | "completed" | "error";

// --- Swarm Step (ReAct loop) ---
// Each step represents one action in the agentic loop
export type SwarmStepType = "thinking" | "searching" | "reading" | "writing" | "final" | "error" | "user_intervention" | "delegating" | "synthesizing" | "waiting_for_user" | "chat";

export interface SwarmStep {
  id: string;
  agentId: string;
  agentName: string;
  type: SwarmStepType;
  title: string; // Short description e.g. "Searching for: best AI stocks"
  content: string; // Full content (search results, page content, agent output, etc.)
  thinking?: string; // Agent's thinking during this step
  timestamp: number;
  urls?: string[]; // URLs involved (for search/read steps)
  searchResults?: SearchResult[]; // For search steps
  duration?: number; // Time taken in ms
}

export interface SwarmConfig {
  topic: string;
  maxSteps: number; // 0 = unlimited; overall limit for the entire swarm
  agents: AgentConfig[];
}

export interface ResearchSession {
  id: string;
  topic: string;
  agents: AgentConfig[];
  status: ResearchStatus;
  maxSteps: number;
  totalSteps: number;
  createdAt: number;
  agentStates: AgentState[];
  finalOutput: string;
  steps: SwarmStep[];
}

export interface ResearchMessage {
  id: string;
  fromAgentId: string;
  toAgentId: string | null; // null = broadcast
  content: string;
  timestamp: number;
  type: "thinking" | "output" | "search" | "instruction" | "question" | "final";
}
