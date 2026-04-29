"use client";

import { useEffect } from "react";
import { useAppStore } from "@/lib/store";
import { AppSidebar, SidebarToggle } from "@/components/shared/AppSidebar";
import { HomeView } from "@/components/home/HomeView";
import { ChatView } from "@/components/chat/ChatView";
import { ResearchView } from "@/components/research/ResearchView";
import { SettingsDialog } from "@/components/settings/SettingsDialog";

export default function Page() {
  const initialize = useAppStore((s) => s.initialize);
  const activeView = useAppStore((s) => s.activeView);
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const settingsOpen = useAppStore((s) => s.settingsOpen);

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
        {/* Sidebar toggle (shown when sidebar is closed) */}
        {!sidebarOpen && <SidebarToggle />}

        <div className="flex-1 overflow-hidden">
          <div className={activeView === "home" ? "" : "hidden h-full"}>
            <HomeView />
          </div>
          <div className={activeView === "chat" ? "" : "hidden h-full"}>
            <ChatView />
          </div>
          <div className={activeView === "research" ? "" : "hidden h-full"}>
            <ResearchView />
          </div>
        </div>
      </main>

      {/* Settings dialog */}
      <SettingsDialog open={settingsOpen} onOpenChange={(open) => useAppStore.getState().setSettingsOpen(open)} />
    </div>
  );
}
