"use client";

import { useEffect } from "react";
import { useAppStore } from "@/lib/store";
import { AppSidebar, SidebarToggle } from "@/components/shared/AppSidebar";
import { HomeView } from "@/components/home/HomeView";
import { ChatView } from "@/components/chat/ChatView";
import { ResearchView } from "@/components/research/ResearchView";
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import { SwarmConfigSheet } from "@/components/shared/SwarmConfigSheet";
import { Button } from "@/components/ui/button";
import { PanelLeft, Settings, Zap } from "lucide-react";

export default function Page() {
  const initialize = useAppStore((s) => s.initialize);
  const activeView = useAppStore((s) => s.activeView);
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const settingsOpen = useAppStore((s) => s.settingsOpen);
  const swarmConfigOpen = useAppStore((s) => s.swarmConfigOpen);

  useEffect(() => {
    initialize();
  }, [initialize]);

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background">
      {/* Sidebar */}
      <AppSidebar />

      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => useAppStore.getState().setSidebarOpen(false)}
        />
      )}

      {/* Main content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile header with sidebar toggle + right action button */}
        <div className="shrink-0 md:hidden flex items-center justify-between px-3 py-2 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 z-10">
          {!sidebarOpen ? <SidebarToggle /> : <div className="w-8" />}
          <div className="flex-1 text-center">
            <span className="text-sm font-semibold text-foreground">NebChat</span>
          </div>
          {/* Right button: swarm config on chat, settings on other views */}
          {activeView === "chat" ? (
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 bg-background/80 backdrop-blur-sm shadow-sm border-border/50 hover:bg-background shrink-0"
              onClick={() => useAppStore.getState().setSwarmConfigOpen(true)}
              aria-label="Open swarm config"
            >
              <Zap className="h-4 w-4 text-fuchsia-500" />
            </Button>
          ) : !settingsOpen ? (
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 bg-background/80 backdrop-blur-sm shadow-sm border-border/50 hover:bg-background shrink-0"
              onClick={() => useAppStore.getState().setSettingsOpen(true)}
              aria-label="Open settings"
            >
              <Settings className="h-4 w-4" />
            </Button>
          ) : (
            <div className="w-8" />
          )}
        </div>

        {/* Desktop floating sidebar toggle (shown when sidebar is closed) */}
        {!sidebarOpen && (
          <Button
            variant="outline"
            size="icon"
            className="hidden md:flex fixed top-3 left-3 z-40 h-8 w-8 bg-background/80 backdrop-blur-sm shadow-sm border-border/50 hover:bg-background"
            onClick={() => useAppStore.getState().setSidebarOpen(true)}
            aria-label="Open sidebar"
          >
            <PanelLeft className="h-4 w-4" />
          </Button>
        )}

        {/* View container — flex column so child views can expand properly */}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <div className={`${activeView === "home" ? "flex-1 min-h-0 flex flex-col" : "hidden"}`}>
            <HomeView />
          </div>
          <div className={`${activeView === "chat" ? "flex-1 min-h-0 flex flex-col" : "hidden"}`}>
            <ChatView />
          </div>
          <div className={`${activeView === "research" ? "flex-1 min-h-0 flex flex-col" : "hidden"}`}>
            <ResearchView />
          </div>
        </div>
      </main>

      {/* Settings dialog */}
      <SettingsDialog open={settingsOpen} onOpenChange={(open) => useAppStore.getState().setSettingsOpen(open)} />

      {/* Swarm Config Sheet */}
      <SwarmConfigSheet />
    </div>
  );
}
