"use client";

import { useEffect } from "react";
import { useAppStore } from "@/lib/store";
import { AppSidebar, SidebarToggle } from "@/components/shared/AppSidebar";
import { HomeView } from "@/components/home/HomeView";
import { ChatView } from "@/components/chat/ChatView";
import { ResearchView } from "@/components/research/ResearchView";
import { SettingsDialog } from "@/components/settings/SettingsDialog";

export default function NebChatApp() {
  const { activeView, initialize, sidebarOpen, setSidebarOpen } = useAppStore();

  useEffect(() => {
    initialize();
  }, [initialize]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background">
      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/40 z-10 md:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <div className={`z-20 md:z-0 ${sidebarOpen ? "fixed md:relative" : ""}`}>
        <AppSidebar />
      </div>

      {/* Main Content - all views stay mounted so streams don't die */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 relative">
        <SidebarToggle />
        <div className={activeView === "home" ? "flex-1 flex flex-col min-h-0" : "hidden"}>
          <HomeView />
        </div>
        <div className={activeView === "chat" ? "flex-1 flex flex-col min-h-0" : "hidden"}>
          <ChatView />
        </div>
        <div className={activeView === "research" ? "flex-1 flex flex-col min-h-0" : "hidden"}>
          <ResearchView />
        </div>
      </div>

      {/* Settings Dialog */}
      <SettingsDialog />
    </div>
  );
}
