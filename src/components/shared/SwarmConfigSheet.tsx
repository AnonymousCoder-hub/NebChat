"use client";

import { useAppStore } from "@/lib/store";
import { generateId } from "@/lib/storage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Zap,
  Bot,
  Crown,
  Search,
  Brain,
  FileText,
  Cpu,
  Plus,
  Trash2,
  Globe,

} from "lucide-react";
import { useState, useMemo, useCallback } from "react";
import { toast } from "sonner";
import type { AgentRole, AgentConfig } from "@/lib/types";

// Role icons
function RoleIcon({ role }: { role: AgentRole }) {
  switch (role) {
    case "manager":
      return <Crown className="h-3 w-3" />;
    case "researcher":
      return <Search className="h-3 w-3" />;
    case "analyst":
      return <Brain className="h-3 w-3" />;
    case "writer":
      return <FileText className="h-3 w-3" />;
    case "coder":
      return <Cpu className="h-3 w-3" />;
    default:
      return <Bot className="h-3 w-3" />;
  }
}

function getDefaultRoleName(role: AgentRole, index: number): string {
  switch (role) {
    case "manager":
      return "Manager";
    case "researcher":
      return `Researcher ${index}`;
    case "analyst":
      return `Analyst ${index}`;
    case "writer":
      return `Writer ${index}`;
    case "coder":
      return `Coder ${index}`;
    default:
      return `Agent ${index}`;
  }
}

const AGENT_COLORS = [
  "#f59e0b",
  "#ef4444",
  "#22c55e",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
  "#f97316",
];

export function SwarmConfigSheet() {
  const swarmConfigOpen = useAppStore((s) => s.swarmConfigOpen);
  const setSwarmConfigOpen = useAppStore((s) => s.setSwarmConfigOpen);
  const providers = useAppStore((s) => s.providers);
  const createSwarmConversation = useAppStore((s) => s.createSwarmConversation);
  const setActiveConversationId = useAppStore((s) => s.setActiveConversationId);
  const setActiveView = useAppStore((s) => s.setActiveView);
  const selectedModelId = useAppStore((s) => s.selectedModelId);
  const selectedProviderId = useAppStore((s) => s.selectedProviderId);

  const enabledProviders = useMemo(
    () => providers.filter((p) => p.isEnabled && p.models.length > 0),
    [providers]
  );

  // Agent config state
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [topic, setTopic] = useState("");

  // Initialize default agent on open
  const handleOpenChange = useCallback(
    (open: boolean) => {
      setSwarmConfigOpen(open);
      if (open && agents.length === 0) {
        const firstProvider = enabledProviders[0];
        const firstModel = firstProvider?.models[0];
        setAgents([
          {
            id: generateId(),
            name: "Lead Agent",
            role: "manager",
            systemPrompt: "",
            modelId: firstModel?.id || selectedModelId || "",
            providerId: firstProvider?.id || selectedProviderId || "",
            searchEnabled: true,
            searchLimit: 25,
            priority: 1,
            thinkingEnabled: true,
            maxIterations: 0,
          },
        ]);
        setTopic("");
      }
    },
    [agents.length, enabledProviders, selectedModelId, selectedProviderId, setSwarmConfigOpen]
  );

  const updateAgent = useCallback(
    (id: string, updates: Partial<AgentConfig>) => {
      setAgents((prev) =>
        prev.map((a) => (a.id === id ? { ...a, ...updates } : a))
      );
    },
    []
  );

  const removeAgent = useCallback((id: string) => {
    setAgents((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const addAgent = useCallback(
    (role: AgentRole = "researcher") => {
      const firstProvider = enabledProviders[0];
      const firstModel = firstProvider?.models[0];
      const newAgent: AgentConfig = {
        id: generateId(),
        name: getDefaultRoleName(
          role,
          agents.filter((a) => a.role === role).length + 1
        ),
        role,
        systemPrompt: "",
        modelId: firstModel?.id || selectedModelId || "",
        providerId: firstProvider?.id || selectedProviderId || "",
        searchEnabled: role === "researcher" || role === "manager",
        searchLimit: role === "researcher" ? 20 : role === "manager" ? 25 : 5,
        priority: agents.length + 1,
        thinkingEnabled: true,
        maxIterations: 0,
      };
      setAgents((prev) => [...prev, newAgent]);
    },
    [agents, enabledProviders, selectedModelId, selectedProviderId]
  );

  const handleStartSwarm = useCallback(() => {
    if (agents.length === 0) {
      toast.error("Add at least one agent");
      return;
    }

    const swarmAgents = agents.map((a) => ({
      name: a.name,
      role: a.role,
      modelId: a.modelId,
      providerId: a.providerId,
      thinkingEnabled: a.thinkingEnabled,
    }));

    const convId = createSwarmConversation(
      topic || "New Swarm Research",
      swarmAgents,
      0
    );
    setActiveConversationId(convId);
    setActiveView("research");
    setSwarmConfigOpen(false);
    toast.success("Swarm started!");
  }, [
    agents,
    topic,
    createSwarmConversation,
    setActiveConversationId,
    setActiveView,
    setSwarmConfigOpen,
  ]);

  return (
    <Sheet open={swarmConfigOpen} onOpenChange={handleOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:w-96 p-0 flex flex-col"
      >
        <SheetHeader className="shrink-0 p-4 pb-3">
          <SheetTitle className="flex items-center gap-2 text-base">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20">
              <Zap className="h-4 w-4 text-fuchsia-500" />
            </div>
            Agentic Swarm
          </SheetTitle>
          <SheetDescription className="text-xs">
            Configure your multi-agent research team
          </SheetDescription>
        </SheetHeader>

        <Separator />

        <ScrollArea className="flex-1 min-h-0">
          <div className="p-4 space-y-4">
            {/* Topic */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Research Topic</Label>
              <Input
                placeholder="What do you want to research?"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                className="h-9 text-sm"
              />
            </div>

            {/* Agent List */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-medium">Agents</Label>
                <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
                  {agents.length}
                </Badge>
              </div>

              {agents.map((agent, index) => {
                const isManager = agent.role === "manager";
                const color = AGENT_COLORS[index % AGENT_COLORS.length];
                return (
                  <div
                    key={agent.id}
                    className="rounded-lg border bg-card p-3 space-y-2"
                    style={{ borderLeftWidth: 3, borderLeftColor: color }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div
                          className="h-5 w-5 rounded flex items-center justify-center text-white text-[9px] font-bold shrink-0"
                          style={{ backgroundColor: color }}
                        >
                          {isManager ? (
                            <Crown className="h-2.5 w-2.5" />
                          ) : (
                            index + 1
                          )}
                        </div>
                        <Input
                          value={agent.name}
                          onChange={(e) =>
                            updateAgent(agent.id, { name: e.target.value })
                          }
                          className="h-7 text-xs border-0 p-0 bg-transparent focus-visible:ring-0"
                          placeholder={getDefaultRoleName(agent.role, index)}
                        />
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Select
                          value={agent.role}
                          onValueChange={(v) =>
                            updateAgent(agent.id, {
                              role: v as AgentRole,
                              name: getDefaultRoleName(
                                v as AgentRole,
                                index
                              ),
                            })
                          }
                        >
                          <SelectTrigger className="h-6 text-[10px] w-[90px] border-0 p-0 bg-transparent">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="manager" className="text-xs">
                              <Crown className="h-3 w-3 inline mr-1 text-amber-500" />
                              Manager
                            </SelectItem>
                            <SelectItem value="researcher" className="text-xs">
                              <Search className="h-3 w-3 inline mr-1 text-emerald-500" />
                              Researcher
                            </SelectItem>
                            <SelectItem value="analyst" className="text-xs">
                              <Brain className="h-3 w-3 inline mr-1 text-blue-500" />
                              Analyst
                            </SelectItem>
                            <SelectItem value="writer" className="text-xs">
                              <FileText className="h-3 w-3 inline mr-1 text-violet-500" />
                              Writer
                            </SelectItem>
                            <SelectItem value="coder" className="text-xs">
                              <Cpu className="h-3 w-3 inline mr-1 text-cyan-500" />
                              Coder
                            </SelectItem>
                          </SelectContent>
                        </Select>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5 text-muted-foreground hover:text-destructive"
                          onClick={() => removeAgent(agent.id)}
                          disabled={isManager}
                        >
                          <Trash2 className="h-2.5 w-2.5" />
                        </Button>
                      </div>
                    </div>

                    {/* Model selector */}
                    <Select
                      value={`${agent.providerId}::${agent.modelId}`}
                      onValueChange={(v) => {
                        const [pid, mid] = v.split("::");
                        updateAgent(agent.id, {
                          providerId: pid,
                          modelId: mid,
                        });
                      }}
                    >
                      <SelectTrigger className="h-7 text-[10px]">
                        <SelectValue placeholder="Select model" />
                      </SelectTrigger>
                      <SelectContent>
                        {enabledProviders.map((p) => (
                          <SelectGroup key={p.id}>
                            <SelectLabel className="text-[9px]">
                              {p.name}
                            </SelectLabel>
                            {p.models.map((m) => (
                              <SelectItem
                                key={`${p.id}::${m.id}`}
                                value={`${p.id}::${m.id}`}
                                className="text-[10px]"
                              >
                                {m.name || m.id}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        ))}
                      </SelectContent>
                    </Select>

                    {/* Toggles */}
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={agent.thinkingEnabled}
                          onChange={(e) =>
                            updateAgent(agent.id, {
                              thinkingEnabled: e.target.checked,
                            })
                          }
                          className="h-3 w-3 rounded border-muted-foreground/30"
                        />
                        <Label className="text-[9px] flex items-center gap-0.5">
                          <Brain className="h-2.5 w-2.5" /> Think
                        </Label>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={agent.searchEnabled}
                          onChange={(e) =>
                            updateAgent(agent.id, {
                              searchEnabled: e.target.checked,
                            })
                          }
                          className="h-3 w-3 rounded border-muted-foreground/30"
                        />
                        <Label className="text-[9px] flex items-center gap-0.5">
                          <Globe className="h-2.5 w-2.5" /> Search
                        </Label>
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Add agent buttons */}
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 gap-1 text-xs h-8"
                  onClick={() => addAgent("researcher")}
                >
                  <Search className="h-3 w-3" /> Researcher
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 gap-1 text-xs h-8"
                  onClick={() => addAgent("analyst")}
                >
                  <Brain className="h-3 w-3" /> Analyst
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 gap-1 text-xs h-8"
                  onClick={() => addAgent("writer")}
                >
                  <FileText className="h-3 w-3" /> Writer
                </Button>
              </div>
            </div>

            {/* Info box */}
            <div className="rounded-lg bg-muted/50 p-3 space-y-1.5">
              <p className="text-[10px] font-medium flex items-center gap-1">
                <Zap className="h-3 w-3 text-fuchsia-500" /> How it works
              </p>
              <ul className="text-[10px] text-muted-foreground space-y-0.5 leading-relaxed">
                <li>Manager coordinates and talks to you</li>
                <li>Researchers search the web for information</li>
                <li>Analysts evaluate and find patterns</li>
                <li>Writers compose final reports</li>
                <li>You can intervene anytime during research</li>
              </ul>
            </div>
          </div>
        </ScrollArea>

        <Separator />

        {/* Footer with start button */}
        <div className="shrink-0 p-4 space-y-2">
          <Button
            className="w-full gap-2 bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:from-violet-600 hover:to-fuchsia-600 text-white h-11"
            onClick={handleStartSwarm}
            disabled={agents.length === 0}
          >
            <Zap className="h-4 w-4" />
            Launch Swarm
          </Button>
          <p className="text-[9px] text-muted-foreground/50 text-center">
            The swarm will research autonomously with you in the loop
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
