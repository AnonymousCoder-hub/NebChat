import { APIProvider, Conversation, Message, SearchProvider } from "./types";

const STORAGE_KEYS = {
  PROVIDERS: "nebchat_providers",
  CONVERSATIONS: "nebchat_conversations",
  ACTIVE_VIEW: "nebchat_active_view",
  ACTIVE_CONVERSATION: "nebchat_active_conversation",
  SELECTED_MODEL: "nebchat_selected_model",
  THINKING_ENABLED: "nebchat_thinking_enabled",
  SEARCH_ENABLED: "nebchat_search_enabled",
  SEARCH_PROVIDERS: "nebchat_search_providers",
  ACTIVE_SEARCH_PROVIDER: "nebchat_active_search_provider",
  PAGE_READER_URL: "nebchat_page_reader_url",
} as const;

function safeGet<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : fallback;
  } catch {
    return fallback;
  }
}

function safeSet(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // localStorage might be full
  }
}

function safeGetString(key: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  return localStorage.getItem(key) || fallback;
}

// --- Providers ---
export function getProviders(): APIProvider[] {
  return safeGet<APIProvider[]>(STORAGE_KEYS.PROVIDERS, []);
}

export function saveProviders(providers: APIProvider[]): void {
  safeSet(STORAGE_KEYS.PROVIDERS, providers);
}

export function addProvider(provider: APIProvider): APIProvider[] {
  const providers = getProviders();
  providers.push(provider);
  saveProviders(providers);
  return providers;
}

export function updateProvider(
  id: string,
  updates: Partial<APIProvider>
): APIProvider[] {
  const providers = getProviders();
  const index = providers.findIndex((p) => p.id === id);
  if (index !== -1) {
    providers[index] = { ...providers[index], ...updates };
    saveProviders(providers);
  }
  return providers;
}

export function removeProvider(id: string): APIProvider[] {
  const providers = getProviders().filter((p) => p.id !== id);
  saveProviders(providers);
  // Also remove conversations for this provider
  const conversations = getConversations().filter((c) => c.providerId !== id);
  saveConversations(conversations);
  return providers;
}

// --- Conversations ---
export function getConversations(): Conversation[] {
  return safeGet<Conversation[]>(STORAGE_KEYS.CONVERSATIONS, []);
}

export function saveConversations(conversations: Conversation[]): void {
  safeSet(STORAGE_KEYS.CONVERSATIONS, conversations);
}

export function addConversation(conversation: Conversation): Conversation[] {
  const conversations = getConversations();
  conversations.unshift(conversation);
  saveConversations(conversations);
  return conversations;
}

export function updateConversation(
  id: string,
  updates: Partial<Conversation>
): Conversation[] {
  const conversations = getConversations();
  const index = conversations.findIndex((c) => c.id === id);
  if (index !== -1) {
    conversations[index] = { ...conversations[index], ...updates };
    saveConversations(conversations);
  }
  return conversations;
}

export function removeConversation(id: string): Conversation[] {
  const conversations = getConversations().filter((c) => c.id !== id);
  saveConversations(conversations);
  return conversations;
}

export function addMessageToConversation(
  conversationId: string,
  message: Message
): Conversation[] {
  const conversations = getConversations();
  const index = conversations.findIndex((c) => c.id === conversationId);
  if (index !== -1) {
    conversations[index].messages.push(message);
    conversations[index].updatedAt = Date.now();
    // Auto-generate title from first user message
    if (
      conversations[index].title === "New Chat" &&
      message.role === "user"
    ) {
      conversations[index].title =
        message.content.slice(0, 50) +
        (message.content.length > 50 ? "..." : "");
    }
    saveConversations(conversations);
  }
  return conversations;
}

export function updateMessageInConversation(
  conversationId: string,
  messageId: string,
  content: string,
  thinking?: string,
  tokenStats?: {
    totalTokens: number;
    totalTimeMs: number;
    tokensPerSecond: number;
    thinkingTokens?: number;
  },
  searchResults?: { title: string; url: string; snippet: string; content?: string }[],
  searchQueries?: string[]
): Conversation[] {
  const conversations = getConversations();
  const convIndex = conversations.findIndex((c) => c.id === conversationId);
  if (convIndex !== -1) {
    const msgIndex = conversations[convIndex].messages.findIndex(
      (m) => m.id === messageId
    );
    if (msgIndex !== -1) {
      conversations[convIndex].messages[msgIndex].content = content;
      if (thinking !== undefined) {
        conversations[convIndex].messages[msgIndex].thinking = thinking;
      }
      if (tokenStats) {
        conversations[convIndex].messages[msgIndex].tokenStats = tokenStats;
      }
      if (searchResults) {
        conversations[convIndex].messages[msgIndex].searchResults = searchResults;
      }
      if (searchQueries) {
        conversations[convIndex].messages[msgIndex].searchQueries = searchQueries;
      }
      conversations[convIndex].updatedAt = Date.now();
      saveConversations(conversations);
    }
  }
  return conversations;
}

// --- UI State ---
export function getActiveView(): string {
  return safeGetString(STORAGE_KEYS.ACTIVE_VIEW, "home");
}

export function setActiveView(view: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEYS.ACTIVE_VIEW, view);
}

export function getActiveConversationId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(STORAGE_KEYS.ACTIVE_CONVERSATION) || null;
}

export function setActiveConversationId(id: string | null): void {
  if (typeof window === "undefined") return;
  if (id) {
    localStorage.setItem(STORAGE_KEYS.ACTIVE_CONVERSATION, id);
  } else {
    localStorage.removeItem(STORAGE_KEYS.ACTIVE_CONVERSATION);
  }
}

export function getSelectedModel(): {
  modelId: string;
  providerId: string;
} | null {
  return safeGet<{ modelId: string; providerId: string } | null>(
    STORAGE_KEYS.SELECTED_MODEL,
    null
  );
}

export function setSelectedModel(
  modelId: string,
  providerId: string
): void {
  safeSet(STORAGE_KEYS.SELECTED_MODEL, { modelId, providerId });
}

// --- Thinking Toggle ---
export function getThinkingEnabled(): boolean {
  if (typeof window === "undefined") return true;
  return localStorage.getItem(STORAGE_KEYS.THINKING_ENABLED) !== "false";
}

export function setThinkingEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEYS.THINKING_ENABLED, String(enabled));
}

// --- Search Toggle ---
export function getSearchEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(STORAGE_KEYS.SEARCH_ENABLED) === "true";
}

export function setSearchEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEYS.SEARCH_ENABLED, String(enabled));
}

// --- Search Providers ---
export function getSearchProviders(): SearchProvider[] {
  return safeGet<SearchProvider[]>(STORAGE_KEYS.SEARCH_PROVIDERS, []);
}

export function saveSearchProviders(providers: SearchProvider[]): void {
  safeSet(STORAGE_KEYS.SEARCH_PROVIDERS, providers);
}

export function addSearchProvider(provider: SearchProvider): SearchProvider[] {
  const providers = getSearchProviders();
  providers.push(provider);
  saveSearchProviders(providers);
  return providers;
}

export function updateSearchProvider(
  id: string,
  updates: Partial<SearchProvider>
): SearchProvider[] {
  const providers = getSearchProviders();
  const index = providers.findIndex((p) => p.id === id);
  if (index !== -1) {
    providers[index] = { ...providers[index], ...updates };
    saveSearchProviders(providers);
  }
  return providers;
}

export function removeSearchProvider(id: string): SearchProvider[] {
  const providers = getSearchProviders().filter((p) => p.id !== id);
  saveSearchProviders(providers);
  return providers;
}

export function getActiveSearchProviderId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(STORAGE_KEYS.ACTIVE_SEARCH_PROVIDER) || null;
}

export function setActiveSearchProviderId(id: string | null): void {
  if (typeof window === "undefined") return;
  if (id) {
    localStorage.setItem(STORAGE_KEYS.ACTIVE_SEARCH_PROVIDER, id);
  } else {
    localStorage.removeItem(STORAGE_KEYS.ACTIVE_SEARCH_PROVIDER);
  }
}

// --- Page Reader URL ---
export function getPageReaderUrl(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(STORAGE_KEYS.PAGE_READER_URL) || null;
}

export function setPageReaderUrl(url: string | null): void {
  if (typeof window === "undefined") return;
  if (url) {
    localStorage.setItem(STORAGE_KEYS.PAGE_READER_URL, url);
  } else {
    localStorage.removeItem(STORAGE_KEYS.PAGE_READER_URL);
  }
}

// --- Utility ---
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export function maskApiKey(key: string): string {
  if (!key || key.length < 8) return "••••••••";
  return key.slice(0, 4) + "••••" + key.slice(-4);
}
