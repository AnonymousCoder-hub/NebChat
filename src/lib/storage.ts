import { APIProvider, Conversation, Message, SearchProvider } from "./types";

const STORAGE_KEYS = {
  PROVIDERS: "nebchat_providers",
  CONVERSATIONS: "nebchat_conversations",
  ACTIVE_VIEW: "nebchat_active_view",
  ACTIVE_CONVERSATION: "nebchat_active_conversation",
  SELECTED_MODEL: "nebchat_selected_model",
  SELECTED_PROVIDER: "nebchat_selected_provider",
  THINKING_ENABLED: "nebchat_thinking_enabled",
  SEARCH_ENABLED: "nebchat_search_enabled",
  SEARCH_PROVIDERS: "nebchat_search_providers",
  ACTIVE_SEARCH_PROVIDER: "nebchat_active_search_provider",
  RESEARCH_SESSIONS: "nebchat_research_sessions",
  PAGE_READER_URL: "nebchat_page_reader_url",
} as const;

// --- Providers ---
export function getProviders(): APIProvider[] {
  if (typeof window === "undefined") return [];
  try {
    const data = localStorage.getItem(STORAGE_KEYS.PROVIDERS);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

export function saveProviders(providers: APIProvider[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEYS.PROVIDERS, JSON.stringify(providers));
}

export function addProvider(provider: APIProvider): APIProvider[] {
  const providers = getProviders();
  providers.push(provider);
  saveProviders(providers);
  return providers;
}

export function updateProvider(id: string, updates: Partial<APIProvider>): APIProvider[] {
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
  if (typeof window === "undefined") return [];
  try {
    const data = localStorage.getItem(STORAGE_KEYS.CONVERSATIONS);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

export function saveConversations(conversations: Conversation[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEYS.CONVERSATIONS, JSON.stringify(conversations));
}

export function addConversation(conversation: Conversation): Conversation[] {
  const conversations = getConversations();
  conversations.unshift(conversation);
  saveConversations(conversations);
  return conversations;
}

export function updateConversation(id: string, updates: Partial<Conversation>): Conversation[] {
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

export function addMessageToConversation(conversationId: string, message: Message): Conversation[] {
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
        message.content.slice(0, 50) + (message.content.length > 50 ? "..." : "");
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
  tokenStats?: { totalTokens: number; totalTimeMs: number; tokensPerSecond: number; thinkingTokens?: number }
): Conversation[] {
  const conversations = getConversations();
  const index = conversations.findIndex((c) => c.id === conversationId);
  if (index !== -1) {
    const msgIndex = conversations[index].messages.findIndex(
      (m) => m.id === messageId
    );
    if (msgIndex !== -1) {
      conversations[index].messages[msgIndex].content = content;
      if (thinking !== undefined) {
        conversations[index].messages[msgIndex].thinking = thinking;
      }
      if (tokenStats) {
        conversations[index].messages[msgIndex].tokenStats = tokenStats;
      }
      conversations[index].updatedAt = Date.now();
      saveConversations(conversations);
    }
  }
  return conversations;
}

// --- UI State ---
export function getActiveView(): string {
  if (typeof window === "undefined") return "home";
  return localStorage.getItem(STORAGE_KEYS.ACTIVE_VIEW) || "home";
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

export function getSelectedModel(): { modelId: string; providerId: string } | null {
  if (typeof window === "undefined") return null;
  try {
    const data = localStorage.getItem(STORAGE_KEYS.SELECTED_MODEL);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

export function setSelectedModel(modelId: string, providerId: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(
    STORAGE_KEYS.SELECTED_MODEL,
    JSON.stringify({ modelId, providerId })
  );
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
  if (typeof window === "undefined") return [];
  try {
    const data = localStorage.getItem(STORAGE_KEYS.SEARCH_PROVIDERS);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

export function saveSearchProviders(providers: SearchProvider[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEYS.SEARCH_PROVIDERS, JSON.stringify(providers));
}

export function addSearchProvider(provider: SearchProvider): SearchProvider[] {
  const providers = getSearchProviders();
  providers.push(provider);
  saveSearchProviders(providers);
  return providers;
}

export function updateSearchProvider(id: string, updates: Partial<SearchProvider>): SearchProvider[] {
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
