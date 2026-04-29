import { create } from "zustand";
import {
  APIProvider,
  Conversation,
  Message,
  AppView,
  ModelInfo,
  SearchProvider,
  TokenStats,
  SwarmStep,
  SearchResult,
} from "./types";
import * as storage from "./storage";

interface AppState {
  // Data
  providers: APIProvider[];
  conversations: Conversation[];
  searchProviders: SearchProvider[];

  // UI State
  activeView: AppView;
  activeConversationId: string | null;
  selectedModelId: string | null;
  selectedProviderId: string | null;
  sidebarOpen: boolean;
  settingsOpen: boolean;
  isStreaming: boolean;
  thinkingEnabled: boolean;
  searchEnabled: boolean;
  activeSearchProviderId: string | null;
  pageReaderUrl: string | null;

  // Actions
  initialize: () => void;
  setActiveView: (view: AppView) => void;
  setSidebarOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;

  // Provider actions
  addProvider: (provider: APIProvider) => void;
  updateProvider: (id: string, updates: Partial<APIProvider>) => void;
  removeProvider: (id: string) => void;
  setProviderModels: (providerId: string, models: ModelInfo[]) => void;

  // Conversation actions
  setActiveConversationId: (id: string | null) => void;
  createConversation: (modelId: string, providerId: string) => string;
  createSwarmConversation: (
    topic: string,
    agents: {
      name: string;
      role: string;
      modelId: string;
      providerId: string;
      thinkingEnabled?: boolean;
    }[],
    maxSteps: number
  ) => string;
  deleteConversation: (id: string) => void;
  addMessage: (conversationId: string, message: Message) => void;
  updateMessage: (
    conversationId: string,
    messageId: string,
    content: string,
    thinking?: string,
    tokenStats?: TokenStats
  ) => void;
  updateMessageSearchResults: (
    conversationId: string,
    messageId: string,
    searchResults: SearchResult[],
    searchQueries: string[]
  ) => void;
  updateSwarmOutput: (conversationId: string, output: string) => void;
  updateSwarmSteps: (conversationId: string, steps: SwarmStep[]) => void;

  // Model selection
  setSelectedModel: (modelId: string, providerId: string) => void;

  // Streaming
  setIsStreaming: (streaming: boolean) => void;

  // Thinking toggle
  setThinkingEnabled: (enabled: boolean) => void;

  // Search toggle
  setSearchEnabled: (enabled: boolean) => void;
  setActiveSearchProviderId: (id: string | null) => void;

  // Page reader
  setPageReaderUrl: (url: string | null) => void;

  // Search provider actions
  addSearchProvider: (provider: SearchProvider) => void;
  updateSearchProvider: (id: string, updates: Partial<SearchProvider>) => void;
  removeSearchProvider: (id: string) => void;

  // Helpers
  getActiveConversation: () => Conversation | undefined;
  getSelectedProvider: () => APIProvider | undefined;
  getSelectedSearchProvider: () => SearchProvider | undefined;
  getAllModels: () => (ModelInfo & { providerName: string })[];
}

export const useAppStore = create<AppState>((set, get) => ({
  providers: [],
  conversations: [],
  searchProviders: [],
  activeView: "home",
  activeConversationId: null,
  selectedModelId: null,
  selectedProviderId: null,
  sidebarOpen: true,
  settingsOpen: false,
  isStreaming: false,
  thinkingEnabled: true,
  searchEnabled: false,
  activeSearchProviderId: null,
  pageReaderUrl: null,

  initialize: () => {
    const providers = storage.getProviders();
    const conversations = storage.getConversations();
    const searchProviders = storage.getSearchProviders();
    const activeView = storage.getActiveView() as AppView;
    const activeConversationId = storage.getActiveConversationId();
    const selected = storage.getSelectedModel();
    const thinkingEnabled = storage.getThinkingEnabled();
    const searchEnabled = storage.getSearchEnabled();
    const activeSearchProviderId = storage.getActiveSearchProviderId();
    const pageReaderUrl = storage.getPageReaderUrl();

    const isMobile =
      typeof window !== "undefined" && window.innerWidth < 768;

    set({
      providers,
      conversations,
      searchProviders,
      activeView: ["home", "chat", "settings", "research"].includes(activeView)
        ? activeView
        : "home",
      activeConversationId,
      selectedModelId: selected?.modelId || null,
      selectedProviderId: selected?.providerId || null,
      sidebarOpen: !isMobile,
      thinkingEnabled,
      searchEnabled,
      activeSearchProviderId,
      pageReaderUrl,
    });
  },

  setActiveView: (view) => {
    storage.setActiveView(view);
    set({ activeView: view });
  },

  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),

  // Provider actions
  addProvider: (provider) => {
    const providers = storage.addProvider(provider);
    set({ providers });
  },

  updateProvider: (id, updates) => {
    const providers = storage.updateProvider(id, updates);
    set({ providers });
  },

  removeProvider: (id) => {
    const providers = storage.removeProvider(id);
    const conversations = storage.getConversations();
    const { selectedProviderId, selectedModelId } = get();
    set({
      providers,
      conversations,
      selectedProviderId:
        selectedProviderId === id ? null : selectedProviderId,
      selectedModelId: selectedProviderId === id ? null : selectedModelId,
    });
  },

  setProviderModels: (providerId, models) => {
    const providers = storage.updateProvider(providerId, { models });
    set({ providers });
  },

  // Conversation actions
  setActiveConversationId: (id) => {
    storage.setActiveConversationId(id);
    if (id) {
      const conv = storage
        .getConversations()
        .find((c) => c.id === id);
      const isMobile =
        typeof window !== "undefined" && window.innerWidth < 768;
      if (conv?.type === "swarm") {
        set({
          activeConversationId: id,
          activeView: "research" as AppView,
          ...(isMobile ? { sidebarOpen: false } : {}),
        });
        storage.setActiveView("research");
      } else {
        set({
          activeConversationId: id,
          activeView: "chat" as AppView,
          ...(isMobile ? { sidebarOpen: false } : {}),
        });
        storage.setActiveView("chat");
      }
    } else {
      set({ activeConversationId: id });
    }
  },

  createConversation: (modelId, providerId) => {
    const id = storage.generateId();
    const conversation: Conversation = {
      id,
      title: "New Chat",
      modelId,
      providerId,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      thinkingEnabled: get().thinkingEnabled,
      searchEnabled: get().searchEnabled,
      type: "chat",
    };
    const conversations = storage.addConversation(conversation);
    storage.setActiveConversationId(id);
    storage.setActiveView("chat");
    set({
      conversations,
      activeConversationId: id,
      activeView: "chat" as AppView,
      selectedModelId: modelId,
      selectedProviderId: providerId,
    });
    storage.setSelectedModel(modelId, providerId);
    return id;
  },

  createSwarmConversation: (topic, agents, maxSteps) => {
    const id = storage.generateId();
    const firstAgent = agents[0];
    const conversation: Conversation = {
      id,
      title: `🐝 ${topic.slice(0, 40)}${topic.length > 40 ? "..." : ""}`,
      modelId: firstAgent?.modelId || "",
      providerId: firstAgent?.providerId || "",
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      type: "swarm",
      swarmConfig: {
        topic,
        maxSteps,
        agents: agents.map((a) => ({
          id: storage.generateId(),
          name: a.name,
          role: a.role,
          systemPrompt: "",
          modelId: a.modelId,
          providerId: a.providerId,
          searchEnabled: false,
          searchLimit: 5,
          priority: 1,
          thinkingEnabled: a.thinkingEnabled ?? true,
          maxIterations: 0,
        })),
      },
    };
    const conversations = storage.addConversation(conversation);
    storage.setActiveConversationId(id);
    storage.setActiveView("research");
    set({
      conversations,
      activeConversationId: id,
      activeView: "research" as AppView,
    });
    return id;
  },

  deleteConversation: (id) => {
    const conversations = storage.removeConversation(id);
    const { activeConversationId } = get();
    if (activeConversationId === id) {
      storage.setActiveConversationId(null);
      storage.setActiveView("home");
      set({
        conversations,
        activeConversationId: null,
        activeView: "home" as AppView,
      });
    } else {
      set({ conversations });
    }
  },

  updateSwarmOutput: (conversationId, output) => {
    const conversations = storage.updateConversation(conversationId, {
      swarmOutput: output,
    });
    set({ conversations });
  },

  updateSwarmSteps: (conversationId, steps) => {
    const conversations = storage.updateConversation(conversationId, {
      swarmSteps: steps,
    });
    set({ conversations });
  },

  addMessage: (conversationId, message) => {
    const conversations = storage.addMessageToConversation(
      conversationId,
      message
    );
    set({ conversations });
  },

  updateMessage: (conversationId, messageId, content, thinking, tokenStats) => {
    const conversations = storage.updateMessageInConversation(
      conversationId,
      messageId,
      content,
      thinking,
      tokenStats
    );
    set({ conversations });
  },

  updateMessageSearchResults: (
    conversationId,
    messageId,
    searchResults,
    searchQueries
  ) => {
    const conversations = storage.updateMessageInConversation(
      conversationId,
      messageId,
      // Keep existing content
      storage
        .getConversations()
        .find((c) => c.id === conversationId)
        ?.messages.find((m) => m.id === messageId)?.content || "",
      undefined,
      undefined,
      searchResults,
      searchQueries
    );
    set({ conversations });
  },

  // Model selection
  setSelectedModel: (modelId, providerId) => {
    storage.setSelectedModel(modelId, providerId);
    set({ selectedModelId: modelId, selectedProviderId: providerId });
  },

  // Streaming
  setIsStreaming: (streaming) => set({ isStreaming: streaming }),

  // Thinking toggle
  setThinkingEnabled: (enabled) => {
    storage.setThinkingEnabled(enabled);
    set({ thinkingEnabled: enabled });
  },

  // Search toggle
  setSearchEnabled: (enabled) => {
    storage.setSearchEnabled(enabled);
    set({ searchEnabled: enabled });
  },

  setActiveSearchProviderId: (id) => {
    storage.setActiveSearchProviderId(id);
    set({ activeSearchProviderId: id });
  },

  // Page reader
  setPageReaderUrl: (url) => {
    storage.setPageReaderUrl(url);
    set({ pageReaderUrl: url });
  },

  // Search provider actions
  addSearchProvider: (provider) => {
    const searchProviders = storage.addSearchProvider(provider);
    set({ searchProviders });
  },

  updateSearchProvider: (id, updates) => {
    const searchProviders = storage.updateSearchProvider(id, updates);
    set({ searchProviders });
  },

  removeSearchProvider: (id) => {
    const searchProviders = storage.removeSearchProvider(id);
    const { activeSearchProviderId } = get();
    set({
      searchProviders,
      activeSearchProviderId:
        activeSearchProviderId === id ? null : activeSearchProviderId,
    });
  },

  // Helpers
  getActiveConversation: () => {
    const { conversations, activeConversationId } = get();
    return conversations.find((c) => c.id === activeConversationId);
  },

  getSelectedProvider: () => {
    const { providers, selectedProviderId } = get();
    return providers.find((p) => p.id === selectedProviderId);
  },

  getSelectedSearchProvider: () => {
    const { searchProviders, activeSearchProviderId } = get();
    return searchProviders.find((p) => p.id === activeSearchProviderId);
  },

  getAllModels: () => {
    const { providers } = get();
    return providers
      .filter((p) => p.isEnabled)
      .flatMap((p) =>
        p.models.map((m) => ({
          ...m,
          providerName: p.name,
          providerId: p.id,
        }))
      );
  },
}));
