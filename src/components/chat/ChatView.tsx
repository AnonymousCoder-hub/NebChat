"use client";

import { useAppStore } from "@/lib/store";
import { generateId } from "@/lib/storage";
import { ModelSelector } from "@/components/shared/ModelSelector";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Send,
  Square,
  Bot,
  User,
  Sparkles,
  Copy,
  Check,
  Brain,
  ChevronDown,
  Loader2,
  Search,
  Globe,
  Zap,
  ExternalLink,
} from "lucide-react";
import { useState, useRef, useEffect, useCallback, memo } from "react";
import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { toast } from "@/hooks/use-toast";
import type { SearchResult, TokenStats, Message } from "@/lib/types";

// --- Per-conversation streaming state (lives outside React) ---
interface StreamSession {
  conversationId: string;
  content: string;
  thinking: string;
  isStreaming: boolean;
  abortController: AbortController | null;
  startTime: number;
  tokenTimestamps: number[];
  thinkingTokenCount: number;
  assistantMessageId: string;
  tps: number;
}

// Global streaming sessions map - persists across component re-renders
const streamSessions = new Map<string, StreamSession>();
// Listeners for UI updates
const streamListeners = new Map<string, Set<() => void>>();

function getStreamSession(conversationId: string): StreamSession | undefined {
  return streamSessions.get(conversationId);
}

function setStreamSession(conversationId: string, session: StreamSession) {
  streamSessions.set(conversationId, session);
  notifyListeners(conversationId);
}

function removeStreamSession(conversationId: string) {
  streamSessions.delete(conversationId);
  notifyListeners(conversationId);
}

function subscribeStream(conversationId: string, listener: () => void) {
  if (!streamListeners.has(conversationId)) {
    streamListeners.set(conversationId, new Set());
  }
  streamListeners.get(conversationId)!.add(listener);
}

function unsubscribeStream(conversationId: string, listener: () => void) {
  streamListeners.get(conversationId)?.delete(listener);
}

function notifyListeners(conversationId: string) {
  streamListeners.get(conversationId)?.forEach((fn) => fn());
}

// Strip any [SEARCH: ...] tags from display (leftover from old flow)
function stripSearchTags(text: string): string {
  return text.replace(/\[SEARCH:\s*.+?\]/gi, "").trim();
}

// Generate search query variations from a user message for comprehensive coverage
function generateSearchVariations(query: string): string[] {
  const variations = [query]; // Always search the original query
  const lower = query.toLowerCase();
  
  // Add time-relevant variation if the query seems factual/news-oriented
  if (/(best|top|latest|current|new|recent|2024|2025|price|stock|weather|news)/i.test(query)) {
    variations.push(`${query} 2025`);
  }
  
  // Add discussion/review variation for product/opinion queries
  if (/(should I|vs|versus|review|opinion|recommend|which|compare)/i.test(query)) {
    variations.push(`${query} reddit discussion`);
  }
  
  return variations.slice(0, 3); // Max 3 variations to avoid rate limiting
}

export function ChatView() {
  const activeConversationId = useAppStore((s) => s.activeConversationId);
  const activeConversation = useAppStore((s) => s.conversations.find((c) => c.id === s.activeConversationId));
  const providers = useAppStore((s) => s.providers);
  const selectedModelId = useAppStore((s) => s.selectedModelId);
  const selectedProviderId = useAppStore((s) => s.selectedProviderId);
  const isStreaming = useAppStore((s) => s.isStreaming);
  const thinkingEnabled = useAppStore((s) => s.thinkingEnabled);
  const searchEnabled = useAppStore((s) => s.searchEnabled);
  const activeSearchProviderId = useAppStore((s) => s.activeSearchProviderId);
  const searchProviders = useAppStore((s) => s.searchProviders);
  const addMessage = useAppStore((s) => s.addMessage);
  const updateMessage = useAppStore((s) => s.updateMessage);
  const setActiveConversationId = useAppStore((s) => s.setActiveConversationId);
  const createConversation = useAppStore((s) => s.createConversation);
  const setSelectedModel = useAppStore((s) => s.setSelectedModel);
  const setIsStreaming = useAppStore((s) => s.setIsStreaming);
  const setThinkingEnabled = useAppStore((s) => s.setThinkingEnabled);
  const setSearchEnabled = useAppStore((s) => s.setSearchEnabled);

  const [input, setInput] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [searchingNow, setSearchingNow] = useState(false);
  const [searchProgress, setSearchProgress] = useState("");

  // Force re-render trigger for streaming updates
  const [, setRenderTick] = useState(0);
  const renderTickRef = useRef(0);
  const tpsTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const chatContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const activeProvider = providers.find(
    (p) => p.id === (activeConversation?.providerId || selectedProviderId)
  );
  const activeSearchProvider = searchProviders.find(
    (p) => p.id === activeSearchProviderId && p.isEnabled
  );

  // Subscribe to stream session updates for the active conversation
  useEffect(() => {
    const listener = () => {
      renderTickRef.current++;
      setRenderTick(renderTickRef.current);
    };

    if (activeConversationId) {
      subscribeStream(activeConversationId, listener);
      return () => unsubscribeStream(activeConversationId, listener);
    }
  }, [activeConversationId]);

  // TPS update timer
  useEffect(() => {
    tpsTimerRef.current = setInterval(() => {
      if (activeConversationId) {
        const session = getStreamSession(activeConversationId);
        if (session && session.isStreaming) {
          const now = Date.now();
          const twoSecondsAgo = now - 2000;
          const recentTokens = session.tokenTimestamps.filter(t => t > twoSecondsAgo);
          const timeSpan = recentTokens.length > 1 ? (now - recentTokens[0]) / 1000 : 1;
          const tps = timeSpan > 0 ? recentTokens.length / timeSpan : 0;
          session.tps = Math.round(tps * 10) / 10;
          notifyListeners(activeConversationId);
        }
      }
    }, 100);
    return () => {
      if (tpsTimerRef.current) clearInterval(tpsTimerRef.current);
    };
  }, [activeConversationId]);

  // Auto-scroll to bottom - using scrollTop on the container directly
  // This avoids scrollIntoView() which scrolls ALL ancestors including the page
  const scrollToBottom = useCallback((smooth = true) => {
    const container = chatContainerRef.current;
    if (container) {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: smooth ? "smooth" : "instant",
      });
    }
  }, []);

  const lastScrollRef = useRef<number>(0);
  useEffect(() => {
    const now = Date.now();
    const session = activeConversationId ? getStreamSession(activeConversationId) : undefined;
    const currentlyStreaming = session?.isStreaming;
    // Throttle during streaming to avoid jank
    if (currentlyStreaming && now - lastScrollRef.current < 300) return;
    lastScrollRef.current = now;
    scrollToBottom(currentlyStreaming ? false : true);
  }, [activeConversation?.messages?.length, activeConversationId, renderTickRef.current, scrollToBottom]);

  // Focus input on conversation change
  useEffect(() => {
    inputRef.current?.focus();
  }, [activeConversationId]);

  const handleModelSelect = (modelId: string, providerId: string) => {
    setSelectedModel(modelId, providerId);
    if (activeConversationId) {
      createConversation(modelId, providerId);
    }
  };

  const handleCopyMessage = (messageId: string, content: string) => {
    navigator.clipboard.writeText(content);
    setCopiedId(messageId);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleStopStreaming = () => {
    if (activeConversationId) {
      const session = getStreamSession(activeConversationId);
      if (session?.abortController) {
        session.abortController.abort();
        session.abortController = null;
      }
      if (session && session.assistantMessageId) {
        const totalTimeMs = Date.now() - session.startTime;
        const totalTokenCount = session.tokenTimestamps.length;
        updateMessage(
          activeConversationId,
          session.assistantMessageId,
          session.content || "*(Generation stopped)*",
          session.thinking || undefined,
          totalTokenCount > 0 ? {
            totalTokens: totalTokenCount,
            totalTimeMs,
            tokensPerSecond: Math.round((totalTokenCount / (totalTimeMs / 1000)) * 10) / 10,
            thinkingTokens: session.thinkingTokenCount,
          } : undefined
        );
      }
      removeStreamSession(activeConversationId);
    }
    setIsStreaming(false);
  };

  // Search the web and read page content
  const searchWeb = useCallback(async (query: string, maxResults = 10): Promise<SearchResult[]> => {
    if (!activeSearchProvider) {
      toast({
        title: "No Search Provider",
        description: "Add a search provider in Settings to enable web search",
        variant: "destructive",
      });
      return [];
    }
    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          provider: {
            type: activeSearchProvider.type,
            baseUrl: activeSearchProvider.baseUrl,
            apiKey: activeSearchProvider.apiKey,
            cxId: activeSearchProvider.cxId,
          },
          maxResults,
          fetchContent: true,
          contentPages: Math.min(maxResults, 5),
          pageReaderUrl: useAppStore.getState().pageReaderUrl || undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Search failed");
      return data.results || [];
    } catch (error) {
      toast({
        title: "Search Failed",
        description: error instanceof Error ? error.message : "Could not search the web",
        variant: "destructive",
      });
      return [];
    }
  }, [activeSearchProvider]);

  // Core stream function - streams an AI response and returns the content
  const streamAIResponse = useCallback(async (
    conversationId: string,
    messages: { role: string; content: string }[],
    model: string,
    provider: { baseUrl: string; apiKey: string },
    thinkingOn: boolean,
    searchResults?: SearchResult[],
    existingMessageId?: string,
  ): Promise<{ content: string; thinking: string; tokenStats: TokenStats } | null> => {
    const session = getStreamSession(conversationId);
    if (!session) return null;

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages,
          model,
          baseUrl: provider.baseUrl,
          apiKey: provider.apiKey,
          stream: true,
          thinkingEnabled: thinkingOn,
          searchResults,
          searchEnabled: useAppStore.getState().searchEnabled,
        }),
        signal: session.abortController!.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";
      let lastNotifyTime = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === "data: [DONE]") continue;
          if (!trimmed.startsWith("data: ")) continue;

          try {
            const json = JSON.parse(trimmed.slice(6));
            const choice = json.choices?.[0];
            if (!choice) continue;
            const delta = choice.delta;
            if (!delta) continue;

            const thinkingDelta = delta.reasoning_content || delta.reasoning || delta.thinking || delta.reasoning_text || null;
            if (thinkingDelta) {
              session.thinking += thinkingDelta;
              session.thinkingTokenCount++;
              session.tokenTimestamps.push(Date.now());
            }

            const contentDelta = delta.content;
            if (contentDelta) {
              session.content += contentDelta;
              session.tokenTimestamps.push(Date.now());
            }
          } catch {
            // Skip malformed JSON
          }
        }

        // Throttle UI updates to ~30fps max to reduce lag
        const now = Date.now();
        if (now - lastNotifyTime > 33) {
          lastNotifyTime = now;
          notifyListeners(conversationId);
        }
      }

      // Final notify to ensure UI shows complete content
      notifyListeners(conversationId);

      const totalTimeMs = Date.now() - session.startTime;
      const totalTokenCount = session.tokenTimestamps.length;
      const finalTps = totalTimeMs > 0 ? Math.round((totalTokenCount / (totalTimeMs / 1000)) * 10) / 10 : 0;

      return {
        content: session.content,
        thinking: session.thinking,
        tokenStats: {
          totalTokens: totalTokenCount,
          totalTimeMs,
          tokensPerSecond: finalTps,
          thinkingTokens: session.thinkingTokenCount,
        },
      };
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        return null;
      }
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      updateMessage(conversationId, session.assistantMessageId, `❌ **Error:** ${errorMessage}`);
      toast({ title: "Chat Error", description: errorMessage, variant: "destructive" });
      return null;
    }
  }, [updateMessage]);

  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim()) return;

      let conversationId = activeConversationId;
      let modelId = selectedModelId;
      let providerId = selectedProviderId;

      // Check if this conversation already has a stream running
      if (conversationId) {
        const existingSession = getStreamSession(conversationId);
        if (existingSession?.isStreaming) {
          toast({ title: "Already streaming", description: "Wait for the current response to finish", variant: "destructive" });
          return;
        }
      }

      if (!conversationId) {
        if (!modelId || !providerId) {
          toast({ title: "Select a model", description: "Please select a model before starting a chat", variant: "destructive" });
          return;
        }
        conversationId = createConversation(modelId, providerId);
      }

      const provider = providers.find((p) => p.id === (providerId || activeConversation?.providerId));
      if (!provider) {
        toast({ title: "Provider not found", description: "The selected provider is no longer available", variant: "destructive" });
        return;
      }

      const currentModelId = modelId || activeConversation?.modelId;
      if (!currentModelId) {
        toast({ title: "No model selected", description: "Please select a model", variant: "destructive" });
        return;
      }

      // Add user message to store
      const userMessage: Message = {
        id: generateId(),
        role: "user",
        content: content.trim(),
        timestamp: Date.now(),
      };
      addMessage(conversationId, userMessage);
      setInput("");
      if (inputRef.current) inputRef.current.style.height = "44px";

      // === SEARCH-FIRST APPROACH ===
      // When search is enabled, search the web BEFORE calling the AI.
      // This ensures the AI has real data to work with and produces accurate answers.
      // Search results are injected as context, never shown as visible messages.
      let searchResults: SearchResult[] = [];
      const currentSearchEnabled = useAppStore.getState().searchEnabled;
      const currentSearchProvider = searchProviders.find(
        (p) => p.id === useAppStore.getState().activeSearchProviderId && p.isEnabled
      );

      if (currentSearchEnabled && currentSearchProvider) {
        setSearchingNow(true);
        setSearchProgress("Generating search queries...");

        // Generate search query variations for comprehensive coverage
        const searchVariations = generateSearchVariations(content.trim());

        // Execute all searches in parallel for speed
        const allResults: SearchResult[] = [];
        const searchPromises = searchVariations.map(async (query, idx) => {
          setSearchProgress(`Searching: "${query.slice(0, 40)}${query.length > 40 ? '...' : ''}"`);
          try {
            const response = await fetch("/api/search", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                query,
                provider: {
                  type: currentSearchProvider.type,
                  baseUrl: currentSearchProvider.baseUrl,
                  apiKey: currentSearchProvider.apiKey,
                  cxId: currentSearchProvider.cxId,
                },
                maxResults: 8,
                fetchContent: true,
                contentPages: 3, // Only read top 3 pages for chat mode
                pageReaderUrl: useAppStore.getState().pageReaderUrl || undefined,
              }),
            });
            const data = await response.json();
            if (response.ok && data.results) return data.results as SearchResult[];
          } catch {
            // Individual search failure is fine, continue with what we have
          }
          return [];
        });

        const searchResponses = await Promise.allSettled(searchPromises);
        for (const resp of searchResponses) {
          if (resp.status === "fulfilled" && resp.value) allResults.push(...resp.value);
        }

        // Deduplicate by URL
        const seenUrls = new Set<string>();
        searchResults = allResults.filter((r) => {
          if (seenUrls.has(r.url)) return false;
          seenUrls.add(r.url);
          return true;
        });

        setSearchProgress(`Found ${searchResults.length} results`);
        setSearchingNow(false);
        setSearchProgress("");
      }

      // Add empty assistant message to store
      const assistantMessageId = generateId();
      addMessage(conversationId, {
        id: assistantMessageId,
        role: "assistant",
        content: "",
        thinking: "",
        timestamp: Date.now(),
        model: currentModelId,
        providerId: provider.id,
        searchResults: searchResults.length > 0 ? searchResults : undefined,
      });

      setIsStreaming(true);

      // Create stream session
      const session: StreamSession = {
        conversationId,
        content: "",
        thinking: "",
        isStreaming: true,
        abortController: new AbortController(),
        startTime: Date.now(),
        tokenTimestamps: [],
        thinkingTokenCount: 0,
        assistantMessageId,
        tps: 0,
      };
      setStreamSession(conversationId, session);

      // Build message history (limit to last 20 messages to prevent lag)
      const conv = useAppStore.getState().conversations.find((c) => c.id === conversationId);
      const currentThinkingEnabled = useAppStore.getState().thinkingEnabled;
      const allMessages = (conv?.messages || [])
        .filter((m) => m.id !== assistantMessageId)
        .map((m) => {
          // Strip thinking from old messages to save context tokens
          if (m.role === "assistant") {
            return { role: m.role, content: m.content || "" };
          }
          return { role: m.role, content: m.content };
        });
      // Keep only last 20 messages to prevent context window overflow and lag
      const messages = allMessages.slice(-20);

      // === Single AI response with search context ===
      // Search results are injected into the API call, not as visible chat messages
      const result = await streamAIResponse(
        conversationId,
        messages,
        currentModelId,
        provider,
        currentThinkingEnabled,
        searchResults.length > 0 ? searchResults : undefined,
        assistantMessageId,
      );

      if (!result) {
        // Aborted or error
        session.isStreaming = false;
        session.abortController = null;
        setTimeout(() => removeStreamSession(conversationId!), 500);
        const anyStreaming = Array.from(streamSessions.values()).some(s => s.isStreaming);
        if (!anyStreaming) setIsStreaming(false);
        return;
      }

      // Save the response
      updateMessage(conversationId, assistantMessageId, result.content, result.thinking || undefined, result.tokenStats);

      session.isStreaming = false;
      session.abortController = null;
      setTimeout(() => removeStreamSession(conversationId!), 500);
      const anyStreaming = Array.from(streamSessions.values()).some(s => s.isStreaming);
      if (!anyStreaming) setIsStreaming(false);
    },
    [
      activeConversationId, selectedModelId, selectedProviderId,
      providers, searchProviders, addMessage, updateMessage,
      createConversation, setIsStreaming, activeConversation, searchWeb,
      streamAIResponse,
    ]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const textarea = e.target;
    textarea.style.height = "44px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
  };

  // Get current streaming state for the active conversation
  const currentSession = activeConversationId ? getStreamSession(activeConversationId) : undefined;
  const isCurrentlyStreaming = currentSession?.isStreaming ?? false;

  // Build the message list: use persisted messages, overlay streaming state on the last one
  const messages = activeConversation?.messages || [];
  const lastMsg = messages[messages.length - 1];
  const isLastStreaming = isCurrentlyStreaming && lastMsg?.role === "assistant" && currentSession?.assistantMessageId === lastMsg?.id;

  // Check if ANY conversation is streaming
  const anyStreamActive = Array.from(streamSessions.values()).some(s => s.isStreaming);

  // No conversation selected
  if (!activeConversation) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="max-w-sm w-full text-center space-y-4">
          <div className="mx-auto w-16 h-16 rounded-2xl bg-muted flex items-center justify-center">
            <Bot className="h-8 w-8 text-muted-foreground" />
          </div>
          <div className="space-y-1.5">
            <h3 className="text-lg font-semibold">Start a Conversation</h3>
            <p className="text-sm text-muted-foreground">Select a model and type your message</p>
          </div>
          <div className="space-y-3">
            <ModelSelector onModelSelect={handleModelSelect} selectedModelId={selectedModelId} selectedProviderId={selectedProviderId} />
            <Textarea ref={inputRef} placeholder="Type your message..." value={input} onChange={handleInputChange} onKeyDown={handleKeyDown} className="min-h-[80px] resize-none" disabled={anyStreamActive} />
            <Button className="w-full gap-2" onClick={() => sendMessage(input)} disabled={!input.trim() || anyStreamActive || (!selectedModelId && !selectedProviderId)}>
              <Send className="h-4 w-4" /> Send Message
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 h-0">
      {/* Chat Header - simplified, just model selector */}
      <div className="shrink-0 border-b px-4 py-2 flex items-center justify-between gap-3 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex items-center gap-2 min-w-0">
          <ModelSelector onModelSelect={handleModelSelect} selectedModelId={activeConversation.modelId} selectedProviderId={activeConversation.providerId} />
        </div>
        <div className="flex items-center gap-1.5">
          {isCurrentlyStreaming && (
            <Badge variant="outline" className="text-[10px] gap-1 border-amber-500/30 text-amber-600">
              <Loader2 className="h-2.5 w-2.5 animate-spin" /> Streaming
            </Badge>
          )}
          {activeProvider && <Badge variant="outline" className="text-[10px] shrink-0">{activeProvider.name}</Badge>}
        </div>
      </div>

      {/* Messages - using plain div with overflow-y-auto instead of ScrollArea */}
      <div ref={chatContainerRef} className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-3xl mx-auto p-2 md:p-4 space-y-4 md:space-y-6">
          {messages.length === 0 && (
            <div className="py-16 text-center space-y-3">
              <Sparkles className="h-8 w-8 mx-auto text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">Start the conversation below</p>
              {searchEnabled && (
                <div className="flex items-center justify-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                  <Globe className="h-3 w-3" /> Web search enabled - AI will search for relevant info
                </div>
              )}
            </div>
          )}
          {messages.map((message, idx) => {
            const isThisStreaming = isLastStreaming && message.id === lastMsg.id;
            // Overlay streaming state for the last message
            const displayContent = isThisStreaming ? currentSession!.content : message.content;
            const displayThinking = isThisStreaming ? currentSession!.thinking : message.thinking;

            return (
              <MemoizedMessageBubble
                key={message.id}
                id={message.id}
                role={message.role}
                content={displayContent}
                thinking={displayThinking}
                model={message.model}
                searchResults={(message as { searchResults?: SearchResult[] }).searchResults}
                tokenStats={(message as { tokenStats?: TokenStats }).tokenStats}
                isCopied={copiedId === message.id}
                onCopy={handleCopyMessage}
                isStreaming={isThisStreaming}
                showTps={isThisStreaming}
                liveTps={isThisStreaming ? (currentSession?.tps ?? 0) : 0}
              />
            );
          })}
          {searchingNow && (
            <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400 animate-pulse">
              <Search className="h-4 w-4" /> {searchProgress || "Searching the web..."}
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input Area - Thinking/Search toggles + input */}
      <div className="shrink-0 border-t bg-background px-2 py-2 md:px-3 md:py-3 pb-[env(safe-area-inset-bottom,8px)]">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-end gap-1 md:gap-2">
            {/* Left side: Toggle buttons */}
            <div className="flex items-center gap-0.5 shrink-0 pb-0.5">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant={thinkingEnabled ? "default" : "ghost"}
                      size="icon"
                      className={`h-10 w-10 md:h-9 md:w-9 rounded-lg ${thinkingEnabled ? "bg-amber-500 hover:bg-amber-600 text-white" : "text-muted-foreground"}`}
                      onClick={() => setThinkingEnabled(!thinkingEnabled)}
                    >
                      <Brain className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <p>Thinking: {thinkingEnabled ? "ON" : "OFF"}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant={searchEnabled ? "default" : "ghost"}
                      size="icon"
                      className={`h-10 w-10 md:h-9 md:w-9 rounded-lg ${searchEnabled ? "bg-emerald-500 hover:bg-emerald-600 text-white" : "text-muted-foreground"}`}
                      onClick={() => setSearchEnabled(!searchEnabled)}
                    >
                      <Globe className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <p>Web Search: {searchEnabled ? "ON" : "OFF"}</p>
                    <p className="text-xs text-muted-foreground">
                      {searchEnabled && !activeSearchProvider ? "Configure in Settings" : searchEnabled ? "Searches web before responding" : "Click to enable"}
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>

            {/* Text input */}
            <Textarea
              ref={inputRef}
              placeholder={searchEnabled && activeSearchProvider ? "Ask — AI will search the web..." : "Message..."}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              className="min-h-[44px] max-h-[150px] resize-none flex-1 text-sm"
              disabled={isCurrentlyStreaming || searchingNow}
              rows={1}
            />

            {/* Send/Stop button */}
            {isCurrentlyStreaming ? (
              <Button variant="destructive" size="icon" className="h-10 w-10 md:h-11 md:w-11 shrink-0 rounded-lg" onClick={handleStopStreaming}>
                <Square className="h-4 w-4" />
              </Button>
            ) : (
              <Button size="icon" className="h-10 w-10 md:h-11 md:w-11 shrink-0 rounded-lg" onClick={() => sendMessage(input)} disabled={!input.trim() || searchingNow}>
                {searchingNow ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            )}
          </div>
          <div className="flex items-center justify-between mt-1">
            <p className="text-[9px] md:text-[10px] text-muted-foreground/60 hidden md:block">
              NebChat uses your API key directly
            </p>
            {(thinkingEnabled || searchEnabled) && (
              <div className="flex items-center gap-1.5">
                {thinkingEnabled && (
                  <Badge variant="outline" className="text-[9px] gap-0.5 border-amber-500/30 text-amber-600 dark:text-amber-400 px-1.5 py-0 h-4">
                    <Brain className="h-2 w-2" /> Think
                  </Badge>
                )}
                {searchEnabled && (
                  <Badge variant="outline" className={`text-[9px] gap-0.5 px-1.5 py-0 h-4 ${activeSearchProvider ? "border-emerald-500/30 text-emerald-600 dark:text-emerald-400" : "border-destructive/30 text-destructive"}`}>
                    <Globe className="h-2 w-2" /> {activeSearchProvider ? "Search" : "No provider"}
                  </Badge>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Thinking Block ---
function ThinkingBlock({ thinking, isStreaming }: { thinking: string; isStreaming: boolean }) {
  const [isOpen, setIsOpen] = useState(true);
  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <button className="flex items-center gap-2 text-xs font-medium text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 transition-colors py-1">
          <Brain className="h-3.5 w-3.5" />
          <span>{isStreaming ? "Thinking..." : "Thought process"}</span>
          {isStreaming && <Loader2 className="h-3 w-3 animate-spin" />}
          <ChevronDown className={`h-3 w-3 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 rounded-lg border border-amber-200/50 dark:border-amber-800/30 bg-amber-50/50 dark:bg-amber-950/20 px-3 py-2.5 text-xs leading-relaxed text-amber-900/80 dark:text-amber-100/80 max-h-[400px] overflow-y-auto">
          <div className="whitespace-pre-wrap break-words">{thinking}</div>
          {isStreaming && <span className="inline-block w-1.5 h-3 bg-amber-500/70 animate-pulse ml-0.5 align-text-bottom" />}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// --- Search Results Block ---
function SearchResultsBlock({ results }: { results: SearchResult[] }) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <button className="flex items-center gap-2 text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 transition-colors py-1">
          <Globe className="h-3.5 w-3.5" />
          <span>{results.length} web source{results.length !== 1 ? "s" : ""} used</span>
          <ChevronDown className={`h-3 w-3 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 space-y-2">
          {results.map((result, i) => (
            <a key={i} href={result.url} target="_blank" rel="noopener noreferrer" className="flex items-start gap-2 p-2 rounded-lg border border-emerald-200/50 dark:border-emerald-800/30 bg-emerald-50/50 dark:bg-emerald-950/20 hover:bg-emerald-100/50 dark:hover:bg-emerald-950/30 transition-colors group">
              <div className="h-5 w-5 rounded bg-emerald-200/50 dark:bg-emerald-800/30 flex items-center justify-center text-[10px] font-bold text-emerald-700 dark:text-emerald-300 shrink-0 mt-0.5">{i + 1}</div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1">
                  <span className="text-xs font-medium text-emerald-800 dark:text-emerald-200 truncate">{result.title}</span>
                  <ExternalLink className="h-2.5 w-2.5 text-emerald-500/50 group-hover:text-emerald-500 shrink-0" />
                </div>
                <p className="text-[10px] text-emerald-700/70 dark:text-emerald-300/70 line-clamp-2 mt-0.5">{result.snippet}</p>
              </div>
            </a>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// --- TPS Counter ---
function TPSCounter({ isStreaming, liveTps, tokenStats }: { isStreaming: boolean; liveTps: number; tokenStats?: TokenStats }) {
  if (isStreaming && liveTps > 0) {
    return (
      <div className="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground/70">
        <Zap className="h-2.5 w-2.5 text-amber-500" />
        <span className="text-amber-600 dark:text-amber-400 font-medium">{liveTps}</span>
        <span>t/s</span>
      </div>
    );
  }
  if (tokenStats && tokenStats.totalTokens > 0) {
    return (
      <div className="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground/60">
        <Zap className="h-2.5 w-2.5" />
        <span className="font-medium">{tokenStats.tokensPerSecond}</span>
        <span>t/s</span>
        <span className="text-muted-foreground/40">·</span>
        <span>{tokenStats.totalTokens} tokens</span>
        {tokenStats.thinkingTokens ? tokenStats.thinkingTokens > 0 && (
          <><span className="text-muted-foreground/40">·</span><span className="text-amber-600/70 dark:text-amber-400/70">{tokenStats.thinkingTokens} thinking</span></>
        ) : null}
        <span className="text-muted-foreground/40">·</span>
        <span>{(tokenStats.totalTimeMs / 1000).toFixed(1)}s</span>
      </div>
    );
  }
  return null;
}

// --- Memoized Message Bubble ---
interface MessageBubbleProps {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  thinking?: string;
  model?: string;
  searchResults?: SearchResult[];
  tokenStats?: TokenStats;
  isCopied: boolean;
  onCopy: (id: string, content: string) => void;
  isStreaming: boolean;
  showTps: boolean;
  liveTps: number;
}

const MemoizedMessageBubble = memo(function MessageBubble({
  id, role, content, thinking, model, searchResults, tokenStats,
  isCopied, onCopy, isStreaming, showTps, liveTps,
}: MessageBubbleProps) {
  const isUser = role === "user";
  const hasThinking = !!thinking;
  const hasSearchResults = !!searchResults?.length;

  // Strip [SEARCH: ...] tags from display content
  const displayContent = isUser ? content : stripSearchTags(content);

  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
      <Avatar className="h-8 w-8 shrink-0 mt-0.5">
        <AvatarFallback className={isUser ? "bg-primary text-primary-foreground text-xs" : "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 text-xs"}>
          {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
        </AvatarFallback>
      </Avatar>
      <div className={`group relative max-w-[80%] space-y-1 ${isUser ? "items-end" : "items-start"}`}>
        <div className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${isUser ? "bg-primary text-primary-foreground rounded-br-md" : "bg-muted rounded-bl-md"}`}>
          {isUser ? (
            <p className="whitespace-pre-wrap">{content}</p>
          ) : (
            <div className="space-y-2">
              {hasThinking && <ThinkingBlock thinking={thinking!} isStreaming={isStreaming && !content} />}
              {hasSearchResults && <SearchResultsBlock results={searchResults!} />}
              <div className="prose prose-sm dark:prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
                <ReactMarkdown
                  components={{
                    code(props) {
                      const { children, className, ...rest } = props;
                      const match = /language-(\w+)/.exec(className || "");
                      const inline = !match;
                      if (inline) {
                        return <code className="bg-background/80 px-1.5 py-0.5 rounded text-xs font-mono" {...rest}>{children}</code>;
                      }
                      return (
                        <div className="relative group/code my-3">
                          <div className="flex items-center justify-between bg-zinc-900 rounded-t-lg px-4 py-2">
                            <span className="text-[10px] text-zinc-400 font-mono">{match[1]}</span>
                            <Button variant="ghost" size="icon" className="h-5 w-5 text-zinc-400 hover:text-zinc-200" onClick={() => navigator.clipboard.writeText(String(children).replace(/\n$/, ""))}>
                              <Copy className="h-3 w-3" />
                            </Button>
                          </div>
                          <SyntaxHighlighter style={oneDark} language={match[1]} PreTag="div" customStyle={{ margin: 0, borderRadius: "0 0 0.5rem 0.5rem", fontSize: "12px" }}>
                            {String(children).replace(/\n$/, "")}
                          </SyntaxHighlighter>
                        </div>
                      );
                    },
                    p({ children }) { return <p className="mb-2 last:mb-0">{children}</p>; },
                    ul({ children }) { return <ul className="mb-2 list-disc pl-4">{children}</ul>; },
                    ol({ children }) { return <ol className="mb-2 list-decimal pl-4">{children}</ol>; },
                    li({ children }) { return <li className="mb-1">{children}</li>; },
                    blockquote({ children }) { return <blockquote className="border-l-2 border-primary/30 pl-3 italic text-muted-foreground">{children}</blockquote>; },
                  }}
                >
                  {displayContent || (isStreaming && !hasThinking ? "▍" : "")}
                </ReactMarkdown>
                {isStreaming && displayContent && (
                  <span className="inline-block w-1.5 h-4 bg-foreground/70 animate-pulse ml-0.5 align-text-bottom" />
                )}
              </div>
            </div>
          )}
        </div>
        <div className={`flex items-center gap-2 ${isUser ? "justify-end" : ""}`}>
          <div className={`flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity ${isUser ? "justify-end" : ""}`}>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onCopy(id, displayContent)}>
              {isCopied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
            </Button>
            {model && !isUser && <span className="text-[10px] text-muted-foreground/60 ml-1">{model}</span>}
          </div>
          {!isUser && (showTps || tokenStats) && (
            <div className="ml-auto">
              <TPSCounter isStreaming={showTps} liveTps={liveTps} tokenStats={tokenStats} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
