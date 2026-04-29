"use client";

import { useAppStore } from "@/lib/store";
import { ThemeToggle } from "@/components/shared/ThemeToggle";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  MessageSquare,
  Plus,
  Settings,
  Home,
  Trash2,
  Sparkles,
  PanelLeftClose,
  PanelLeft,
  FlaskConical,
  Zap,
  Bot,
  Circle,
} from "lucide-react";
import { cn } from "@/lib/utils";

export function AppSidebar() {
  const {
    conversations,
    activeConversationId,
    activeView,
    sidebarOpen,
    setActiveView,
    setActiveConversationId,
    createConversation,
    deleteConversation,
    setSidebarOpen,
    selectedModelId,
    selectedProviderId,
    providers,
    setSelectedModel,
  } = useAppStore();

  // Get all available models from enabled providers
  const enabledProviders = providers.filter((p) => p.isEnabled);
  const allModels = enabledProviders.flatMap((p) =>
    p.models.map((m) => ({
      ...m,
      providerId: p.id,
      providerName: p.name,
      providerBaseUrl: p.baseUrl,
    }))
  );

  // Separate conversations by type
  const chatConversations = conversations.filter((c) => c.type !== "swarm");
  const swarmConversations = conversations.filter((c) => c.type === "swarm");

  const handleNewChat = () => {
    if (selectedModelId && selectedProviderId) {
      createConversation(selectedModelId, selectedProviderId);
    } else {
      setActiveView("home");
    }
  };

  const handleConversationClick = (conv: typeof conversations[0]) => {
    setActiveConversationId(conv.id);
    if (conv.type === "swarm") {
      setActiveView("research");
    }
  };

  const handleModelSelect = (modelId: string, providerId: string) => {
    setSelectedModel(modelId, providerId);
  };

  return (
    <div
      className={cn(
        "flex flex-col h-full bg-muted/30 border-r transition-all duration-300",
        sidebarOpen ? "w-72" : "w-0 overflow-hidden border-r-0"
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-3 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-primary text-primary-foreground shrink-0">
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h1 className="font-bold text-sm truncate">NebChat</h1>
            <p className="text-[10px] text-muted-foreground truncate">BYOK AI Chat</p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={() => setSidebarOpen(false)}
        >
          <PanelLeftClose className="h-4 w-4" />
        </Button>
      </div>

      <Separator />

      {/* Action Buttons */}
      <div className="p-3 space-y-2 shrink-0">
        <Button
          className="w-full justify-start gap-2"
          size="sm"
          onClick={handleNewChat}
        >
          <Plus className="h-4 w-4" />
          New Chat
        </Button>
        <Button
          variant="outline"
          className="w-full justify-start gap-2 bg-gradient-to-r from-violet-500/10 via-fuchsia-500/10 to-pink-500/10 border-violet-500/30 hover:border-violet-500/50 hover:from-violet-500/20 hover:via-fuchsia-500/20 hover:to-pink-500/20 text-violet-700 dark:text-violet-300 transition-all"
          size="sm"
          onClick={() => setActiveView("research")}
        >
          <Zap className="h-4 w-4 text-fuchsia-500" />
          <span className="font-medium bg-gradient-to-r from-violet-600 to-fuchsia-600 dark:from-violet-400 dark:to-fuchsia-400 bg-clip-text text-transparent">
            Agentic Swarm
          </span>
        </Button>
      </div>

      {/* Available Models List */}
      {allModels.length > 0 && (
        <div className="px-3 pb-2 shrink-0">
          <div className="space-y-0.5">
            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-2 py-1">
              Available Models
            </div>
            <div className="max-h-32 overflow-y-auto space-y-0.5">
              {allModels.map((model) => {
                const isSelected = model.id === selectedModelId && model.providerId === selectedProviderId;
                return (
                  <button
                    key={`${model.providerId}::${model.id}`}
                    className={cn(
                      "w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-xs cursor-pointer transition-colors text-left",
                      isSelected
                        ? "bg-primary/10 text-primary font-medium"
                        : "hover:bg-accent/50 text-muted-foreground hover:text-foreground"
                    )}
                    onClick={() => handleModelSelect(model.id, model.providerId)}
                  >
                    <Circle className={cn("h-2 w-2 shrink-0", isSelected ? "fill-emerald-500 text-emerald-500" : "fill-muted-foreground/30 text-muted-foreground/30")} />
                    <span className="truncate flex-1">{model.name || model.id}</span>
                    <Badge variant="outline" className="text-[8px] px-1 py-0 h-3 shrink-0">{model.providerName}</Badge>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <Separator />

      {/* Conversations List */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="px-3 space-y-1">
          {/* Swarm Conversations */}
          {swarmConversations.length > 0 && (
            <>
              <div className="flex items-center gap-1.5 px-2 pt-2 pb-1">
                <FlaskConical className="h-3 w-3 text-fuchsia-500" />
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Swarm Sessions</span>
              </div>
              {swarmConversations.map((conv) => (
                <div
                  key={conv.id}
                  className={cn(
                    "group flex items-center gap-2 rounded-md px-2 py-2 text-sm cursor-pointer transition-colors",
                    activeConversationId === conv.id && activeView === "research"
                      ? "bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300 border border-fuchsia-500/20"
                      : "hover:bg-accent/50 text-muted-foreground hover:text-foreground"
                  )}
                  onClick={() => handleConversationClick(conv)}
                >
                  <div className="h-5 w-5 rounded flex items-center justify-center bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20 shrink-0">
                    <Zap className="h-3 w-3 text-fuchsia-500" />
                  </div>
                  <span className="truncate flex-1 text-xs">{conv.title}</span>
                  {conv.swarmOutput && (
                    <div className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 opacity-0 group-hover:opacity-100 shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteConversation(conv.id);
                    }}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
              <div className="py-1">
                <Separator />
              </div>
            </>
          )}

          {/* Chat Conversations */}
          {chatConversations.length > 0 && (
            <>
              <div className="flex items-center gap-1.5 px-2 pt-1 pb-1">
                <MessageSquare className="h-3 w-3 text-muted-foreground/50" />
                <span className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider">Chats</span>
              </div>
              {chatConversations.map((conv) => (
                <div
                  key={conv.id}
                  className={cn(
                    "group flex items-center gap-2 rounded-md px-2 py-2 text-sm cursor-pointer transition-colors",
                    activeConversationId === conv.id && activeView === "chat"
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-accent/50 text-muted-foreground hover:text-foreground"
                  )}
                  onClick={() => handleConversationClick(conv)}
                >
                  <MessageSquare className="h-4 w-4 shrink-0" />
                  <span className="truncate flex-1 text-xs">{conv.title}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 opacity-0 group-hover:opacity-100 shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteConversation(conv.id);
                    }}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </>
          )}

          {/* Empty state */}
          {conversations.length === 0 && (
            <div className="py-8 text-center">
              <MessageSquare className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
              <p className="text-xs text-muted-foreground">No conversations yet</p>
              <p className="text-[10px] text-muted-foreground/60 mt-1">
                Start a new chat or swarm to begin
              </p>
            </div>
          )}
        </div>
      </div>

      <Separator />

      {/* Footer */}
      <div className="p-3 space-y-1 shrink-0">
        <Button
          variant={activeView === "home" ? "secondary" : "ghost"}
          size="sm"
          className="w-full justify-start gap-2"
          onClick={() => setActiveView("home")}
        >
          <Home className="h-4 w-4" />
          Home
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2"
          onClick={() => useAppStore.getState().setSettingsOpen(true)}
        >
          <Settings className="h-4 w-4" />
          Settings
        </Button>
        <div className="flex items-center justify-between pt-1">
          <span className="text-[10px] text-muted-foreground">Theme</span>
          <ThemeToggle />
        </div>
      </div>
    </div>
  );
}

export function SidebarToggle() {
  const { sidebarOpen, setSidebarOpen } = useAppStore();

  if (sidebarOpen) return null;

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-8 w-8 fixed top-3 left-3 z-40"
      onClick={() => setSidebarOpen(true)}
    >
      <PanelLeft className="h-4 w-4" />
    </Button>
  );
}
