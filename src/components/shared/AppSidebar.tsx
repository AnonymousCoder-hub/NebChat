"use client";

import { useCallback, useMemo } from "react";
import { useAppStore } from "@/lib/store";
import { ThemeToggle } from "@/components/shared/ThemeToggle";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  MessageSquare,
  Plus,
  Settings,
  Home,
  Trash2,
  Sparkles,
  PanelLeftClose,
  PanelLeft,
  Zap,
  Bot,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";

// ─── Sidebar Content (shared between mobile Sheet & desktop) ─────────────────

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const {
    conversations,
    activeConversationId,
    activeView,
    setActiveView,
    setActiveConversationId,
    createConversation,
    createSwarmConversation,
    deleteConversation,
    setSidebarOpen,
    selectedModelId,
    selectedProviderId,
    providers,
    getAllModels,
  } = useAppStore();

  const isMobile = useIsMobile();

  // Derived data
  const allModels = useMemo(() => getAllModels(), [getAllModels, providers]);

  const chatConversations = useMemo(
    () => conversations.filter((c) => c.type !== "swarm"),
    [conversations]
  );

  const swarmConversations = useMemo(
    () => conversations.filter((c) => c.type === "swarm"),
    [conversations]
  );

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleNewChat = useCallback(() => {
    const models = getAllModels();
    if (models.length > 0) {
      const model = models.find(
        (m) => m.id === selectedModelId && m.providerId === selectedProviderId
      ) ?? models[0];
      createConversation(model.id, model.providerId);
    } else {
      setActiveView("home");
    }
    onNavigate?.();
  }, [
    getAllModels,
    selectedModelId,
    selectedProviderId,
    createConversation,
    setActiveView,
    onNavigate,
  ]);

  const handleNewSwarm = useCallback(() => {
    const models = getAllModels();
    if (models.length > 0) {
      const model = models.find(
        (m) => m.id === selectedModelId && m.providerId === selectedProviderId
      ) ?? models[0];
      createSwarmConversation(
        "New Swarm Research",
        [
          {
            name: "Lead Agent",
            role: "manager",
            modelId: model.id,
            providerId: model.providerId,
            thinkingEnabled: true,
          },
        ],
        10
      );
    } else {
      setActiveView("home");
    }
    onNavigate?.();
  }, [
    getAllModels,
    selectedModelId,
    selectedProviderId,
    createSwarmConversation,
    setActiveView,
    onNavigate,
  ]);

  const handleConversationClick = useCallback(
    (conv: (typeof conversations)[0]) => {
      setActiveConversationId(conv.id);
      onNavigate?.();
    },
    [setActiveConversationId, onNavigate]
  );

  const handleDelete = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      deleteConversation(id);
    },
    [deleteConversation]
  );

  const handleHome = useCallback(() => {
    setActiveView("home");
    onNavigate?.();
  }, [setActiveView, onNavigate]);

  const handleSettings = useCallback(() => {
    useAppStore.getState().setSettingsOpen(true);
    onNavigate?.();
  }, [onNavigate]);

  const handleCollapse = useCallback(() => {
    setSidebarOpen(false);
  }, [setSidebarOpen]);

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col bg-background">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-3 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-primary text-primary-foreground shrink-0 shadow-sm">
            <span className="text-sm leading-none" role="img" aria-label="Bee">
              🐝
            </span>
          </div>
          <div className="min-w-0">
            <h1 className="font-bold text-sm leading-tight truncate text-foreground">
              NebChat
            </h1>
            <p className="text-[10px] text-muted-foreground leading-tight truncate">
              BYOK AI Chat
            </p>
          </div>
        </div>
        {!isMobile && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
            onClick={handleCollapse}
            aria-label="Collapse sidebar"
          >
            <PanelLeftClose className="h-4 w-4" />
          </Button>
        )}
      </div>

      <Separator className="shrink-0" />

      {/* ── Action Buttons ─────────────────────────────────────────────── */}
      <div className="px-3 py-3 space-y-2 shrink-0">
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
          className="w-full justify-start gap-2 bg-gradient-to-r from-violet-500/10 via-fuchsia-500/10 to-pink-500/10 border-fuchsia-500/30 hover:border-fuchsia-500/50 hover:from-violet-500/15 hover:via-fuchsia-500/15 hover:to-pink-500/15 transition-all"
          size="sm"
          onClick={handleNewSwarm}
        >
          <Zap className="h-4 w-4 text-fuchsia-500 shrink-0" />
          <span className="font-medium bg-gradient-to-r from-violet-600 to-fuchsia-600 dark:from-violet-400 dark:to-fuchsia-400 bg-clip-text text-transparent">
            Agentic Swarm
          </span>
        </Button>
      </div>

      <Separator className="shrink-0" />

      {/* ── Conversations List ─────────────────────────────────────────── */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="px-3 py-2 space-y-1">
          {/* Swarm Sessions */}
          {swarmConversations.length > 0 && (
            <div className="space-y-0.5">
              <div className="flex items-center gap-1.5 px-2 pt-1 pb-1.5">
                <Bot className="h-3 w-3 text-fuchsia-500" />
                <span className="text-[10px] font-semibold text-fuchsia-600 dark:text-fuchsia-400 uppercase tracking-wider">
                  Swarm Sessions
                </span>
                <Badge
                  variant="secondary"
                  className="ml-auto text-[9px] px-1.5 py-0 h-4 bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400 border-fuchsia-500/20"
                >
                  {swarmConversations.length}
                </Badge>
              </div>
              {swarmConversations.map((conv) => {
                const isActive =
                  activeConversationId === conv.id &&
                  activeView === "research";
                return (
                  <div
                    key={conv.id}
                    className={cn(
                      "group flex items-center gap-2 rounded-lg px-2 py-2 text-sm cursor-pointer transition-all duration-150",
                      isActive
                        ? "bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300 ring-1 ring-fuchsia-500/20"
                        : "hover:bg-muted/60 text-muted-foreground hover:text-foreground"
                    )}
                    onClick={() => handleConversationClick(conv)}
                    role="button"
                    tabIndex={0}
                    aria-current={isActive ? "page" : undefined}
                  >
                    <div
                      className={cn(
                        "h-5 w-5 rounded-md flex items-center justify-center shrink-0",
                        isActive
                          ? "bg-fuchsia-500/20"
                          : "bg-gradient-to-br from-violet-500/10 to-fuchsia-500/10"
                      )}
                    >
                      <Zap
                        className={cn(
                          "h-3 w-3",
                          isActive
                            ? "text-fuchsia-600 dark:text-fuchsia-400"
                            : "text-fuchsia-500"
                        )}
                      />
                    </div>
                    <span className="truncate flex-1 text-xs font-medium">
                      {conv.title}
                    </span>
                    {conv.swarmOutput && (
                      <div
                        className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0"
                        title="Completed"
                      />
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className={cn(
                        "h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive",
                        isActive
                          ? "opacity-100"
                          : "opacity-0 group-hover:opacity-100"
                      )}
                      onClick={(e) => handleDelete(e, conv.id)}
                      aria-label={`Delete ${conv.title}`}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                );
              })}
              <div className="py-1.5">
                <Separator />
              </div>
            </div>
          )}

          {/* Chat Conversations */}
          {chatConversations.length > 0 && (
            <div className="space-y-0.5">
              <div className="flex items-center gap-1.5 px-2 pt-1 pb-1.5">
                <MessageSquare className="h-3 w-3 text-muted-foreground/60" />
                <span className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider">
                  Chats
                </span>
                <Badge
                  variant="secondary"
                  className="ml-auto text-[9px] px-1.5 py-0 h-4"
                >
                  {chatConversations.length}
                </Badge>
              </div>
              {chatConversations.map((conv) => {
                const isActive =
                  activeConversationId === conv.id &&
                  activeView === "chat";
                return (
                  <div
                    key={conv.id}
                    className={cn(
                      "group flex items-center gap-2 rounded-lg px-2 py-2 text-sm cursor-pointer transition-all duration-150",
                      isActive
                        ? "bg-accent text-accent-foreground"
                        : "hover:bg-muted/60 text-muted-foreground hover:text-foreground"
                    )}
                    onClick={() => handleConversationClick(conv)}
                    role="button"
                    tabIndex={0}
                    aria-current={isActive ? "page" : undefined}
                  >
                    <MessageSquare
                      className={cn(
                        "h-4 w-4 shrink-0",
                        isActive
                          ? "text-foreground"
                          : "text-muted-foreground/50"
                      )}
                    />
                    <span className="truncate flex-1 text-xs">{conv.title}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className={cn(
                        "h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive",
                        isActive
                          ? "opacity-100"
                          : "opacity-0 group-hover:opacity-100"
                      )}
                      onClick={(e) => handleDelete(e, conv.id)}
                      aria-label={`Delete ${conv.title}`}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Empty State */}
          {conversations.length === 0 && (
            <div className="py-10 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted/50">
                <MessageSquare className="h-5 w-5 text-muted-foreground/40" />
              </div>
              <p className="text-xs font-medium text-muted-foreground">
                No conversations yet
              </p>
              <p className="text-[10px] text-muted-foreground/50 mt-1">
                Start a new chat or swarm to begin
              </p>
            </div>
          )}
        </div>
      </ScrollArea>

      <Separator className="shrink-0" />

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <div className="px-3 py-3 space-y-1 shrink-0">
        <Button
          variant={activeView === "home" ? "secondary" : "ghost"}
          size="sm"
          className="w-full justify-start gap-2"
          onClick={handleHome}
        >
          <Home className="h-4 w-4" />
          Home
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2"
          onClick={handleSettings}
        >
          <Settings className="h-4 w-4" />
          Settings
        </Button>
        <div className="flex items-center justify-between pt-1 px-1">
          <span className="text-[10px] text-muted-foreground font-medium">
            Theme
          </span>
          <ThemeToggle />
        </div>
      </div>
    </div>
  );
}

// ─── Main Export: AppSidebar ─────────────────────────────────────────────────

export function AppSidebar() {
  const isMobile = useIsMobile();
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);

  // On mobile, render as a Sheet (drawer from the left)
  if (isMobile) {
    return (
      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent
          side="left"
          className="w-72 p-0 [&>button]:hidden"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>NebChat Sidebar</SheetTitle>
            <SheetDescription>Navigate conversations and settings</SheetDescription>
          </SheetHeader>
          <SidebarContent
            onNavigate={() => setSidebarOpen(false)}
          />
        </SheetContent>
      </Sheet>
    );
  }

  // On desktop, render as a fixed collapsible sidebar
  return (
    <aside
      className={cn(
        "flex flex-col h-full border-r border-border transition-[width] duration-300 ease-in-out overflow-hidden shrink-0",
        sidebarOpen ? "w-72" : "w-0 border-r-0"
      )}
      aria-label="Sidebar"
    >
      <SidebarContent />
    </aside>
  );
}

// ─── SidebarToggle: floating button to reopen sidebar ────────────────────────

export function SidebarToggle() {
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);

  if (sidebarOpen) return null;

  return (
    <Button
      variant="outline"
      size="icon"
      className="fixed top-3 left-3 z-40 h-8 w-8 bg-background/80 backdrop-blur-sm shadow-sm border-border/50 hover:bg-background"
      onClick={() => setSidebarOpen(true)}
      aria-label="Open sidebar"
    >
      <PanelLeft className="h-4 w-4" />
    </Button>
  );
}
