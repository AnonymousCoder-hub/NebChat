// ============================================================
// NebChat — Type Definitions
// ============================================================

// --- Provider Types ---
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

// --- Chat Types ---
export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  thinking?: string;
  timestamp: number;
  model?: string;
  providerId?: string;
  searchResults?: SearchResult[];
  searchQueries?: string[];
  tokenStats?: TokenStats;
  isStreaming?: boolean;
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
  systemPrompt?: string;
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
export type SearchProviderType =
  | "duckduckgo"
  | "searxng"
  | "brave"
  | "serper"
  | "tavily"
  | "google_cse";

export interface SearchProvider {
  id: string;
  name: string;
  type: SearchProviderType;
  baseUrl?: string;
  apiKey?: string;
  cxId?: string;
  isEnabled: boolean;
  addedAt: number;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  content?: string;
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

// --- Agent / Swarm Types ---
export type AgentRole =
  | "manager"
  | "researcher"
  | "analyst"
  | "writer"
  | "coder"
  | "custom";

export interface AgentConfig {
  id: string;
  name: string;
  role: AgentRole;
  systemPrompt: string;
  modelId: string;
  providerId: string;
  searchEnabled: boolean;
  searchLimit: number;
  priority: number;
  thinkingEnabled: boolean;
  maxIterations: number;
}

export type AgentStatus =
  | "idle"
  | "thinking"
  | "searching"
  | "reading"
  | "writing"
  | "done"
  | "error";

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

export type ResearchStatus =
  | "idle"
  | "running"
  | "paused"
  | "completed"
  | "error";

// --- Swarm Step Types ---
export type SwarmStepType =
  | "thinking"
  | "searching"
  | "reading"
  | "writing"
  | "final"
  | "error"
  | "user_intervention"
  | "delegating"
  | "synthesizing"
  | "waiting_for_user"
  | "chat";

export interface SwarmStep {
  id: string;
  agentId: string;
  agentName: string;
  type: SwarmStepType;
  title: string;
  content: string;
  thinking?: string;
  timestamp: number;
  urls?: string[];
  searchResults?: SearchResult[];
  duration?: number;
}

export interface SwarmConfig {
  topic: string;
  maxSteps: number;
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

// --- Todo Types for Swarm ---
export interface TodoItem {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed";
  assignedTo?: string;
  result?: string;
}

// --- Research Message ---
export interface ResearchMessage {
  id: string;
  fromAgentId: string;
  toAgentId: string | null;
  content: string;
  timestamp: number;
  type: "thinking" | "output" | "search" | "instruction" | "question" | "final";
}
