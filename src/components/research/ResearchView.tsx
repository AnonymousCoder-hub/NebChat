"use client";

import { useAppStore } from "@/lib/store";
import { generateId } from "@/lib/storage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectGroup,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  FlaskConical,
  Plus,
  Trash2,
  Play,
  Square,
  Brain,
  Globe,
  Loader2,
  ChevronDown,
  ChevronUp,
  Zap,
  Search,
  Bot,
  AlertCircle,
  Check,
  ArrowRight,
  RotateCcw,
  Activity,
  Eye,
  BookOpen,
  Send,
  FileText,
  Clock,
  ExternalLink,
  CornerDownRight,
  Settings,
  Crown,
  Users,
  Cpu,
  Handshake,
  MessageSquareQuote,
  ListTodo,
  Pause,
  MessageCircle,
  PanelLeftClose,
  PanelLeft,
} from "lucide-react";
import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { toast } from "@/hooks/use-toast";
import ReactMarkdown from "react-markdown";
import type { AgentConfig, AgentRole, SwarmStep, SwarmStepType, SearchResult } from "@/lib/types";

// Agent colors
const AGENT_COLORS = [
  "#ef4444", "#22c55e", "#3b82f6", "#8b5cf6", "#ec4899", "#06b6d4", "#f97316",
];
const MANAGER_COLOR = "#f59e0b";
function getAgentColor(agent: AgentConfig, index: number) {
  return agent.role === "manager" ? MANAGER_COLOR : AGENT_COLORS[index % AGENT_COLORS.length];
}

function RoleIcon({ role }: { role: AgentRole }) {
  switch (role) {
    case "manager": return <Crown className="h-3 w-3" />;
    case "researcher": return <Search className="h-3 w-3" />;
    case "analyst": return <Brain className="h-3 w-3" />;
    case "writer": return <FileText className="h-3 w-3" />;
    case "coder": return <Cpu className="h-3 w-3" />;
    default: return <Bot className="h-3 w-3" />;
  }
}

function getRoleBadgeStyle(role: AgentRole) {
  switch (role) {
    case "manager": return "border-amber-500/40 text-amber-600 dark:text-amber-400";
    case "researcher": return "border-emerald-500/40 text-emerald-600 dark:text-emerald-400";
    case "analyst": return "border-blue-500/40 text-blue-600 dark:text-blue-400";
    case "writer": return "border-violet-500/40 text-violet-600 dark:text-violet-400";
    case "coder": return "border-cyan-500/40 text-cyan-600 dark:text-cyan-400";
    default: return "border-gray-500/40 text-gray-600 dark:text-gray-400";
  }
}

// Parse manager action tags
function parseManagerAction(text: string): { type: "delegate" | "search" | "read" | "synthesize" | "final" | "chat"; agentName?: string; task?: string; query?: string; url?: string; value?: string } | null {
  // [DELEGATE: agent_name | task description] — multi-line task support
  const delegateMatch = text.match(/\[DELEGATE:\s*(.+?)\s*\|\s*([\s\S]*?)\]/i);
  if (delegateMatch) return { type: "delegate", agentName: delegateMatch[1].trim(), task: delegateMatch[2].trim() };
  // [SEARCH: query]
  const searchMatch = text.match(/\[SEARCH:\s*(.+?)\]/i);
  if (searchMatch) return { type: "search", query: searchMatch[1].trim() };
  // [READ: url]
  const readMatch = text.match(/\[READ:\s*(.+?)\]/i);
  if (readMatch) return { type: "read", url: readMatch[1].trim() };
  // [SYNTHESIZE]
  const synthMatch = text.match(/\[SYNTHESIZE\]/i);
  if (synthMatch) return { type: "synthesize" };
  // [FINAL: answer]
  const finalMatch = text.match(/\[FINAL:\s*([\s\S]*)\]/i);
  if (finalMatch) return { type: "final", value: finalMatch[1].trim() };
  // [CHAT: message to user] — greedy match to capture multi-line messages
  const chatMatch = text.match(/\[CHAT:\s*([\s\S]*)\]/i);
  if (chatMatch) return { type: "chat", value: chatMatch[1].trim() };
  return null;
}

// Parse action tags from both thinking AND content (manager may put tags in thinking)
function parseManagerActionFull(thinking: string, content: string): ReturnType<typeof parseManagerAction> {
  // First check content (preferred)
  const contentAction = parseManagerAction(content);
  if (contentAction) return contentAction;
  // Then check thinking (fallback — LLMs often put action tags in reasoning)
  const thinkingAction = parseManagerAction(thinking);
  if (thinkingAction) return thinkingAction;
  // Finally check combined text
  return parseManagerAction(thinking + "\n" + content);
}

// Parse worker action tags
function parseWorkerAction(text: string): { type: "search" | "read" | "final"; value: string } | null {
  const searchMatch = text.match(/\[SEARCH:\s*(.+?)\]/i);
  if (searchMatch) return { type: "search", value: searchMatch[1].trim() };
  const readMatch = text.match(/\[READ:\s*(.+?)\]/i);
  if (readMatch) return { type: "read", value: readMatch[1].trim() };
  const finalMatch = text.match(/\[FINAL:\s*([\s\S]*)\]/i);
  if (finalMatch) return { type: "final", value: finalMatch[1].trim() };
  return null;
}

// Parse worker action tags from both thinking AND content
function parseWorkerActionFull(thinking: string, content: string): ReturnType<typeof parseWorkerAction> {
  const contentAction = parseWorkerAction(content);
  if (contentAction) return contentAction;
  const thinkingAction = parseWorkerAction(thinking);
  if (thinkingAction) return thinkingAction;
  return parseWorkerAction(thinking + "\n" + content);
}

function stripActionTags(text: string): string {
  return text
    .replace(/\[(?:SEARCH|READ|FINAL|DELEGATE|SYNTHESIZE|CHAT):[\s\S]*?\]/gi, "")
    .replace(/\[SYNTHESIZE\]/gi, "")
    .replace(/\[WAIT_FOR_USER\]/gi, "")
    .trim();
}

// Default system prompts per role
function getDefaultSystemPrompt(role: AgentRole): string {
  switch (role) {
    case "manager":
      return `You are a Manager agent. You coordinate research by talking to the user and delegating to your team.

CRITICAL RULES:
1. You MUST use action tags in EVERY response. No exceptions.
2. First talk to the user with [CHAT: ...] to understand their needs.
3. Then delegate research tasks to your team members.
4. Only use [FINAL: answer] AFTER research has been done (by you or your team).

ACTIONS (output EXACTLY ONE per response):
- [CHAT: message] — Talk to the user and WAIT for their response. The loop PAUSES until they reply. Use to ask questions, propose plans, or give updates.
- [DELEGATE: agent_name | task description] — Assign a research task to a team member. They will search the web and report back.
- [SEARCH: query] — Search the web yourself (use this when you need to do research directly, especially when working alone)
- [READ: url] — Read a web page for detailed content (use after searching to get deeper information)
- [SYNTHESIZE] — Combine all findings into a coherent summary
- [FINAL: comprehensive answer] — Deliver the final answer with all research findings and sources

STRATEGY (follow this exact order):
1. [CHAT: ...] — Ask the user clarifying questions about their request
2. WAIT for user response
3. Delegate research tasks or do research yourself with [SEARCH: ...] and [READ: ...]
4. Collect findings from all sources
5. If more research needed, search more or delegate more tasks
6. [SYNTHESIZE] — Combine all findings
7. [FINAL: answer] — Deliver comprehensive answer with sources

IMPORTANT: Do NOT provide answers without doing research first! Always SEARCH and READ before FINAL!`;
    case "researcher":
      return `You are a thorough research agent. Your job is to search the web extensively and read pages for detailed information.

Use these actions:
- [SEARCH: your search query] — Search the web (use multiple diverse queries!)
- [READ: url] — Read the full content of a web page
- [FINAL: your findings] — Provide findings when done

Rules:
- Search MULTIPLE queries (at least 3-5 different searches) to get comprehensive results from diverse sources
- Always READ the most promising URLs to get actual content, not just snippets
- Include specific data, numbers, quotes, and details from sources
- Cite sources with URLs
- Be thorough — aim to cover the topic from multiple angles
- For stock/market queries, search for recent news, analysis, expert opinions, and data`;
    case "analyst":
      return `You are a critical analyst. Analyze findings and identify patterns/gaps.

Use these actions:
- [SEARCH: query] — Search for more information if needed
- [READ: url] — Read a page for deeper analysis
- [FINAL: your analysis] — Provide analysis when done

Rules:
- Identify patterns, trends, contradictions
- Point out gaps in data
- Be critical and evidence-based`;
    case "writer":
      return `You are a skilled writer. Compose well-structured reports and summaries.

Use these actions:
- [SEARCH: query] — Search for missing facts
- [FINAL: your written output] — Provide composition when done

Rules:
- Write clearly with proper structure
- Cite all sources`;
    case "coder":
      return `You are a coding expert. Write, analyze, or debug code.

Use these actions:
- [SEARCH: query] — Search for docs/examples
- [READ: url] — Read documentation
- [FINAL: your code/output] — Provide code when done`;
    default:
      return `You are a helpful agent. Use [SEARCH: query] to search, [READ: url] to read, and [FINAL: answer] when done.`;
  }
}

function getDefaultRoleName(role: AgentRole, index: number): string {
  switch (role) {
    case "manager": return "Manager";
    case "researcher": return `Researcher ${index}`;
    case "analyst": return `Analyst ${index}`;
    case "writer": return `Writer ${index}`;
    case "coder": return `Coder ${index}`;
    default: return `Agent ${index}`;
  }
}

// --- Streaming LLM Call ---
async function callLLMStream(
  messages: { role: string; content: string }[],
  model: string,
  baseUrl: string,
  apiKey: string,
  thinkingEnabled: boolean,
  signal: AbortSignal,
  onChunk?: (thinking: string, content: string) => void,
): Promise<{ thinking: string; content: string }> {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, model, baseUrl, apiKey, stream: true, thinkingEnabled }),
    signal,
  });

  if (!response.ok) throw new Error(`LLM call failed: HTTP ${response.status}`);

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");
  const decoder = new TextDecoder();
  let buffer = "";
  let thinking = "";
  let content = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === "data: [DONE]" || !trimmed.startsWith("data: ")) continue;
      try {
        const json = JSON.parse(trimmed.slice(6));
        const delta = json.choices?.[0]?.delta;
        if (!delta) continue;
        const thinkingDelta = delta.reasoning_content || delta.reasoning || delta.thinking || delta.reasoning_text;
        if (thinkingDelta) thinking += thinkingDelta;
        if (delta.content) content += delta.content;
        if (onChunk) onChunk(thinking, content);
      } catch { /* skip */ }
    }
  }

  return { thinking, content };
}

// --- Task Tracker ---
interface TaskInfo {
  agentName: string;
  task: string;
  status: "pending" | "running" | "completed" | "failed";
  result?: string;
}

// --- Agent Config Card ---
function AgentConfigCard({
  agent, index, onUpdate, onRemove, providers,
}: {
  agent: AgentConfig; index: number;
  onUpdate: (id: string, updates: Partial<AgentConfig>) => void;
  onRemove: (id: string) => void;
  providers: { id: string; name: string; models: { id: string; name: string }[] }[];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const isManager = agent.role === "manager";
  const color = getAgentColor(agent, index);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card className={`border-l-4 ${isManager ? "ring-1 ring-amber-500/20" : ""}`} style={{ borderLeftColor: color }}>
        <CardContent className="p-2.5 space-y-2">
          <div className="flex items-center justify-between">
            <CollapsibleTrigger asChild>
              <button className="flex items-center gap-1.5 text-xs font-medium">
                <div className="h-5 w-5 rounded flex items-center justify-center text-white text-[9px] font-bold" style={{ backgroundColor: color }}>
                  {isManager ? <Crown className="h-2.5 w-2.5" /> : index + 1}
                </div>
                <span className="truncate max-w-[100px]">{agent.name || getDefaultRoleName(agent.role, index)}</span>
                <Badge variant="outline" className={`text-[9px] px-1 py-0 h-3.5 ${getRoleBadgeStyle(agent.role)}`}>
                  <RoleIcon role={agent.role} /> <span className="ml-0.5 capitalize">{agent.role}</span>
                </Badge>
                {isOpen ? <ChevronUp className="h-3 w-3 text-muted-foreground" /> : <ChevronDown className="h-3 w-3 text-muted-foreground" />}
              </button>
            </CollapsibleTrigger>
            <Button variant="ghost" size="icon" className="h-5 w-5 text-destructive" onClick={() => onRemove(agent.id)} disabled={isManager}>
              <Trash2 className="h-2.5 w-2.5" />
            </Button>
          </div>
          <CollapsibleContent>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-0.5">
                <Label className="text-[9px]">Name</Label>
                <Input value={agent.name} onChange={(e) => onUpdate(agent.id, { name: e.target.value })} placeholder={getDefaultRoleName(agent.role, index)} className="h-7 text-[10px]" />
              </div>
              <div className="space-y-0.5">
                <Label className="text-[9px]">Role</Label>
                <Select value={agent.role} onValueChange={(v) => onUpdate(agent.id, { role: v as AgentRole, systemPrompt: getDefaultSystemPrompt(v as AgentRole) })}>
                  <SelectTrigger className="h-7 text-[10px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manager" className="text-[10px]"><Crown className="h-3 w-3 inline mr-1 text-amber-500" />Manager</SelectItem>
                    <SelectItem value="researcher" className="text-[10px]"><Search className="h-3 w-3 inline mr-1 text-emerald-500" />Researcher</SelectItem>
                    <SelectItem value="analyst" className="text-[10px]"><Brain className="h-3 w-3 inline mr-1 text-blue-500" />Analyst</SelectItem>
                    <SelectItem value="writer" className="text-[10px]"><FileText className="h-3 w-3 inline mr-1 text-violet-500" />Writer</SelectItem>
                    <SelectItem value="coder" className="text-[10px]"><Cpu className="h-3 w-3 inline mr-1 text-cyan-500" />Coder</SelectItem>
                    <SelectItem value="custom" className="text-[10px]"><Bot className="h-3 w-3 inline mr-1" />Custom</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-0.5 mt-2">
              <Label className="text-[9px]">System Prompt</Label>
              <Textarea value={agent.systemPrompt} onChange={(e) => onUpdate(agent.id, { systemPrompt: e.target.value })} placeholder="Define behavior..." className="min-h-[40px] text-[10px] resize-none" rows={2} />
            </div>
            <div className="grid grid-cols-2 gap-2 mt-2">
              <div className="space-y-0.5">
                <Label className="text-[9px]">Model</Label>
                <Select value={`${agent.providerId}::${agent.modelId}`} onValueChange={(v) => { const [pid, mid] = v.split("::"); onUpdate(agent.id, { providerId: pid, modelId: mid }); }}>
                  <SelectTrigger className="h-7 text-[10px]"><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {providers.map((p) => (
                      <SelectGroup key={p.id}>
                        <SelectLabel className="text-[9px]">{p.name}</SelectLabel>
                        {p.models.map((m) => (
                          <SelectItem key={`${p.id}::${m.id}`} value={`${p.id}::${m.id}`} className="text-[10px]">{m.name || m.id}</SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-0.5">
                <Label className="text-[9px]">Max Steps: {agent.maxIterations === 0 ? "∞" : agent.maxIterations}</Label>
                <Slider value={[agent.maxIterations]} onValueChange={([v]) => onUpdate(agent.id, { maxIterations: v })} min={0} max={30} step={1} className="mt-1.5" />
              </div>
            </div>
            <div className="flex items-center gap-3 mt-2">
              <div className="flex items-center gap-1.5">
                <Switch checked={agent.thinkingEnabled} onCheckedChange={(c) => onUpdate(agent.id, { thinkingEnabled: c })} className="scale-75" />
                <Label className="text-[9px] flex items-center gap-0.5"><Brain className="h-2.5 w-2.5" /> Think</Label>
              </div>
              <div className="flex items-center gap-1.5">
                <Switch checked={agent.searchEnabled} onCheckedChange={(c) => onUpdate(agent.id, { searchEnabled: c })} className="scale-75" />
                <Label className="text-[9px] flex items-center gap-0.5"><Globe className="h-2.5 w-2.5" /> Search</Label>
              </div>
            </div>
          </CollapsibleContent>
        </CardContent>
      </Card>
    </Collapsible>
  );
}

// --- Swarm Step Card ---
function StepCard({ step, agentColor, isLast }: { step: SwarmStep; agentColor: string; isLast: boolean }) {
  const [isOpen, setIsOpen] = useState(step.type === "error" || step.type === "final" || step.type === "delegating" || step.type === "synthesizing" || step.type === "waiting_for_user" || step.type === "chat");

  const iconMap: Record<SwarmStepType, React.ReactNode> = {
    thinking: <Brain className="h-3.5 w-3.5 text-amber-500" />,
    searching: <Search className="h-3.5 w-3.5 text-emerald-500" />,
    reading: <BookOpen className="h-3.5 w-3.5 text-blue-500" />,
    writing: <Loader2 className="h-3.5 w-3.5 text-blue-500 animate-spin" />,
    final: <Check className="h-3.5 w-3.5 text-emerald-500" />,
    error: <AlertCircle className="h-3.5 w-3.5 text-destructive" />,
    user_intervention: <CornerDownRight className="h-3.5 w-3.5 text-violet-500" />,
    delegating: <Handshake className="h-3.5 w-3.5 text-amber-600" />,
    synthesizing: <MessageSquareQuote className="h-3.5 w-3.5 text-fuchsia-500" />,
    waiting_for_user: <MessageCircle className="h-3.5 w-3.5 text-amber-500" />,
    chat: <MessageCircle className="h-3.5 w-3.5 text-amber-500" />,
  };

  const bgMap: Record<SwarmStepType, string> = {
    thinking: "border-amber-500/20 bg-amber-50/50 dark:bg-amber-950/10",
    searching: "border-emerald-500/20 bg-emerald-50/50 dark:bg-emerald-950/10",
    reading: "border-blue-500/20 bg-blue-50/50 dark:bg-blue-950/10",
    writing: "border-blue-500/20 bg-blue-50/50 dark:bg-blue-950/10",
    final: "border-emerald-500/20 bg-emerald-50/50 dark:bg-emerald-950/10",
    error: "border-destructive/20 bg-destructive/5",
    user_intervention: "border-violet-500/20 bg-violet-50/50 dark:bg-violet-950/10",
    delegating: "border-amber-500/30 bg-amber-50/50 dark:bg-amber-950/15",
    synthesizing: "border-fuchsia-500/30 bg-fuchsia-50/50 dark:bg-fuchsia-950/15",
    waiting_for_user: "border-amber-500/30 bg-amber-50/50 dark:bg-amber-950/15",
    chat: "border-amber-500/30 bg-amber-50/50 dark:bg-amber-950/15",
  };

  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center shrink-0">
        <div className="h-7 w-7 rounded-full border-2 flex items-center justify-center shrink-0" style={{ borderColor: agentColor, backgroundColor: `${agentColor}15` }}>
          {iconMap[step.type]}
        </div>
        {!isLast && <div className="w-0.5 flex-1 bg-border mt-1 min-h-[20px]" />}
      </div>
      <div className={`flex-1 rounded-lg border p-3 mb-2 ${bgMap[step.type]}`}>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold" style={{ color: agentColor }}>{step.agentName}</span>
          <span className="text-[10px] text-muted-foreground">{step.title}</span>
          {step.duration != null && (
            <span className="text-[9px] text-muted-foreground/60 ml-auto flex items-center gap-0.5">
              <Clock className="h-2.5 w-2.5" />{(step.duration / 1000).toFixed(1)}s
            </span>
          )}
          {(step.content || step.thinking) && (
            <button onClick={() => setIsOpen(!isOpen)} className="ml-1">
              <ChevronDown className={`h-3 w-3 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} />
            </button>
          )}
        </div>
        {step.urls && step.urls.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {step.urls.map((url, i) => (
              <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="text-[9px] text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-0.5 max-w-[200px] truncate">
                <ExternalLink className="h-2 w-2 shrink-0" />{url}
              </a>
            ))}
          </div>
        )}
        {/* Live streaming indicator */}
        {step.type === "thinking" && !step.duration && (
          <div className="mt-1.5 space-y-1.5">
            <div className="flex items-center gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
              <span className="text-[10px] text-muted-foreground italic">
                {step.thinking ? "Thinking..." : step.content ? "Typing..." : "Processing..."}
              </span>
            </div>
            {/* Show live content preview as plain text during streaming */}
            {step.content && (
              <div className="text-[10px] text-foreground/60 italic whitespace-pre-wrap break-words max-h-24 overflow-y-auto border-l-2 border-muted-foreground/20 pl-2">
                {step.content.slice(-300)}
              </div>
            )}
          </div>
        )}
        {/* Waiting for user indicator */}
        {step.type === "waiting_for_user" && !step.duration && (
          <div className="mt-1.5 flex items-center gap-1.5 animate-pulse">
            <MessageCircle className="h-3 w-3 text-amber-500" />
            <span className="text-[10px] text-amber-600 dark:text-amber-400 font-medium italic">
              Waiting for your response...
            </span>
          </div>
        )}
        {isOpen && (step.content || step.thinking) && (
          <div className="mt-2 space-y-2">
            {step.thinking && (
              <div className="rounded-md border border-amber-200/30 dark:border-amber-800/20 bg-amber-50/30 dark:bg-amber-950/10 p-2">
                <div className="flex items-center gap-1 text-[10px] font-medium text-amber-600 dark:text-amber-400 mb-1">
                  <Brain className="h-2.5 w-2.5" /> Thinking
                </div>
                <p className="text-[10px] text-amber-800/70 dark:text-amber-200/70 whitespace-pre-wrap break-words max-h-32 overflow-y-auto">{step.thinking}</p>
              </div>
            )}
            {step.content && (
              <div className={`text-[10px] text-foreground/80 whitespace-pre-wrap break-words ${step.type === "waiting_for_user" || step.type === "chat" ? "" : "max-h-48"} overflow-y-auto prose prose-xs dark:prose-invert max-w-none`}>
                {step.duration != null ? (
                  <ReactMarkdown>{step.content}</ReactMarkdown>
                ) : (
                  <span className="italic text-foreground/60">{step.content.slice(-500)}</span>
                )}
              </div>
            )}
            {step.searchResults && step.searchResults.length > 0 && (
              <div className="space-y-1">
                {step.searchResults.map((r, i) => (
                  <div key={i} className="flex items-start gap-1.5 text-[9px]">
                    <span className="text-emerald-600 dark:text-emerald-400 font-medium shrink-0">[{i + 1}]</span>
                    <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline truncate">{r.title}</a>
                    <span className="text-muted-foreground line-clamp-1">{r.snippet.slice(0, 80)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// --- Main Agentic Swarm View ---
export function ResearchView() {
  const { providers, searchProviders, activeSearchProviderId, activeConversationId, conversations, createSwarmConversation, addMessage, updateSwarmOutput } = useAppStore();
  const updateSwarmSteps = useAppStore((s) => s.updateSwarmSteps);
  const enabledProviders = providers.filter((p) => p.isEnabled && p.models.length > 0);
  const activeSearchProvider = searchProviders.find((p) => p.id === activeSearchProviderId && p.isEnabled);

  const activeSwarmConversation = activeConversationId
    ? conversations.find((c) => c.id === activeConversationId && c.type === "swarm")
    : null;

  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [topic, setTopic] = useState("");
  const [maxSteps, setMaxSteps] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [totalSteps, setTotalSteps] = useState(0);
  const [steps, setSteps] = useState<SwarmStep[]>([]);
  const [finalOutput, setFinalOutput] = useState("");
  const [activeTab, setActiveTab] = useState<"activity" | "agents" | "output">("activity");
  const [swarmConversationId, setSwarmConversationId] = useState<string | null>(null);
  const [userIntervention, setUserIntervention] = useState("");
  const [pendingIntervention, setPendingIntervention] = useState<string | null>(null);
  const [showConfig, setShowConfig] = useState(true);
  const [liveStreamText, setLiveStreamText] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const configScrollRef = useRef<HTMLDivElement>(null);
  const activityScrollRef = useRef<HTMLDivElement>(null);
  const knowledgeBaseRef = useRef<string[]>([]);
  const totalStepsRef = useRef(0);
  const taskTrackerRef = useRef<TaskInfo[]>([]);
  const currentLiveStepIdRef = useRef<string | null>(null);
  const waitForUserResolverRef = useRef<((value: string) => void) | null>(null);
  const [isWaitingForUser, setIsWaitingForUser] = useState(false);
  const stepsSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-scroll
  useEffect(() => {
    const container = activityScrollRef.current;
    if (container) container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
  }, [steps, liveStreamText]);

  // Load existing swarm
  useEffect(() => {
    if (activeSwarmConversation) {
      setTopic(activeSwarmConversation.swarmConfig?.topic || "");
      setMaxSteps(activeSwarmConversation.swarmConfig?.maxSteps ?? 0);
      setFinalOutput(activeSwarmConversation.swarmOutput || "");
      setActiveTab(activeSwarmConversation.swarmOutput ? "output" : "activity");
      if (activeSwarmConversation.swarmConfig?.agents) setAgents(activeSwarmConversation.swarmConfig.agents);
      if (activeSwarmConversation.swarmSteps?.length) setSteps(activeSwarmConversation.swarmSteps);
    }
  }, [activeSwarmConversation?.id]);

  // Sync steps to store (debounced to avoid setState-during-render errors)
  const updateSwarmStepsRef = useRef(updateSwarmSteps);
  updateSwarmStepsRef.current = updateSwarmSteps;
  useEffect(() => {
    if (swarmConversationId && steps.length > 0) {
      if (stepsSyncTimerRef.current) clearTimeout(stepsSyncTimerRef.current);
      stepsSyncTimerRef.current = setTimeout(() => {
        updateSwarmStepsRef.current(swarmConversationId, steps);
      }, 200);
    }
    return () => {
      if (stepsSyncTimerRef.current) clearTimeout(stepsSyncTimerRef.current);
    };
  }, [steps, swarmConversationId]);

  const managerAgent = agents.find((a) => a.role === "manager");

  const addAgent = (role: AgentRole = "researcher") => {
    const firstProvider = enabledProviders[0];
    const firstModel = firstProvider?.models[0];
    const newAgent: AgentConfig = {
      id: generateId(),
      name: getDefaultRoleName(role, agents.filter(a => a.role === role).length + 1),
      role,
      systemPrompt: getDefaultSystemPrompt(role),
      modelId: firstModel?.id || "",
      providerId: firstProvider?.id || "",
      searchEnabled: role === "researcher" || role === "manager",
      searchLimit: role === "researcher" ? 20 : role === "manager" ? 25 : 5,
      priority: agents.length + 1,
      thinkingEnabled: true,
      maxIterations: 0,
    };
    setAgents(prev => [...prev, newAgent]);
  };

  const updateAgent = (id: string, updates: Partial<AgentConfig>) => {
    setAgents(prev => prev.map((a) => (a.id === id ? { ...a, ...updates } : a)));
  };

  const removeAgent = (id: string) => {
    const agent = agents.find((a) => a.id === id);
    if (agent?.role === "manager") return;
    setAgents(prev => prev.filter((a) => a.id !== id));
  };

  const searchWeb = useCallback(async (query: string, numResults = 20): Promise<SearchResult[]> => {
    if (!activeSearchProvider) return [];
    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          provider: { type: activeSearchProvider.type, baseUrl: activeSearchProvider.baseUrl, apiKey: activeSearchProvider.apiKey, cxId: activeSearchProvider.cxId },
          maxResults: numResults,
          fetchContent: true,
          contentPages: Math.min(numResults, 8),
          pageReaderUrl: useAppStore.getState().pageReaderUrl || undefined,
        }),
      });
      const data = await response.json();
      return data.results || [];
    } catch { return []; }
  }, [activeSearchProvider]);

  const readUrl = useCallback(async (url: string): Promise<string> => {
    const pageReaderUrl = useAppStore.getState().pageReaderUrl;
    try {
      if (pageReaderUrl) {
        const crawlResponse = await fetch(`${pageReaderUrl.replace(/\/+$/, "")}/crawl`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
          signal: AbortSignal.timeout(15000),
        });
        if (crawlResponse.ok) {
          const crawlData = await crawlResponse.json();
          const markdown = crawlData?.content?.markdown || "";
          if (markdown) return markdown.length > 8000 ? markdown.slice(0, 8000) + "\n...(truncated)" : markdown;
        }
      }
      const pageResponse = await fetch(`https://r.jina.ai/${encodeURIComponent(url)}`, {
        headers: { Accept: "text/plain" },
        signal: AbortSignal.timeout(15000),
      });
      if (pageResponse.ok) {
        const text = await pageResponse.text();
        return text.length > 8000 ? text.slice(0, 8000) + "\n...(truncated)" : text;
      }
    } catch { /* failed */ }
    return "Failed to read page content.";
  }, []);

  const addStep = useCallback((step: SwarmStep) => {
    setSteps(prev => [...prev, step]);
    totalStepsRef.current += 1;
    setTotalSteps(totalStepsRef.current);
  }, []);

  const updateStep = useCallback((stepId: string, updates: Partial<SwarmStep>) => {
    setSteps(prev => prev.map((s) => s.id === stepId ? { ...s, ...updates } : s));
  }, []);

  const addToKnowledge = useCallback((entry: string) => {
    knowledgeBaseRef.current = [...knowledgeBaseRef.current, entry];
  }, []);

  const getKnowledgeText = useCallback(() => knowledgeBaseRef.current.join("\n\n---\n\n"), []);

  const checkMaxSteps = useCallback(() => maxSteps > 0 && totalStepsRef.current >= maxSteps, [maxSteps]);

  // Get task tracker status text
  const getTaskTrackerText = useCallback(() => {
    const tasks = taskTrackerRef.current;
    if (tasks.length === 0) return "No tasks delegated yet.";
    return tasks.map((t, i) => `${i + 1}. [${t.status.toUpperCase()}] ${t.agentName}: "${t.task.slice(0, 60)}"${t.status === "completed" ? " ✓" : t.status === "running" ? " ⏳" : t.status === "failed" ? " ✗" : " ⏸"}`).join("\n");
  }, []);

  // Reset everything
  const resetSwarm = useCallback(() => {
    if (waitForUserResolverRef.current) {
      waitForUserResolverRef.current("Swarm was reset");
      waitForUserResolverRef.current = null;
    }
    setIsWaitingForUser(false);
    setSteps([]);
    setFinalOutput("");
    setTotalSteps(0);
    totalStepsRef.current = 0;
    knowledgeBaseRef.current = [];
    taskTrackerRef.current = [];
    setPendingIntervention(null);
    setUserIntervention("");
    setLiveStreamText("");
    currentLiveStepIdRef.current = null;
    setActiveTab("activity");
    toast({ title: "Swarm reset", description: "All progress cleared" });
  }, []);

  // --- Run a worker agent ---
  const runWorkerAgent = useCallback(async (
    agent: AgentConfig,
    task: string,
    abortSignal: AbortSignal,
  ): Promise<string> => {
    const provider = providers.find((p) => p.id === agent.providerId);
    if (!provider) throw new Error(`Provider not found for agent ${agent.name}`);

    const observations: string[] = [];
    let currentInput = task;
    const maxIter = agent.maxIterations || 0;
    let iter = 0;

    addStep({
      id: generateId(), agentId: agent.id, agentName: agent.name, type: "thinking",
      title: `Starting: "${task.slice(0, 60)}${task.length > 60 ? "..." : ""}"`,
      content: "", timestamp: Date.now(),
    });

    while (maxIter === 0 || iter < maxIter) {
      if (abortSignal.aborted) break;
      if (checkMaxSteps()) break;
      iter++;

      const stepId = generateId();
      currentLiveStepIdRef.current = stepId;
      setLiveStreamText("");
      addStep({
        id: stepId, agentId: agent.id, agentName: agent.name, type: "thinking",
        title: `Step ${iter}: Thinking...`, content: "", timestamp: Date.now(),
      });

      const stepStart = Date.now();
      const agenticSystemPrompt = `${agent.systemPrompt || "You are an autonomous research agent."}

Role: ${agent.role}. Step ${iter}${maxIter > 0 ? ` of ${maxIter}` : " (unlimited)"}.

ACTIONS (output EXACTLY ONE per response):
- [SEARCH: query] — Search the web
- [READ: url] — Read a web page  
- [FINAL: answer] — Done, provide findings

Rules:
- After search/read, decide if you need more or can finalize
- Be thorough — search multiple queries if needed
- Cite sources${observations.length > 0 ? `\n\nPrevious observations:\n${observations.join("\n\n")}` : ""}`;

      let agentThinking = "";
      let agentOutput = "";

      try {
        const result = await callLLMStream(
          [{ role: "system", content: agenticSystemPrompt }, { role: "user", content: currentInput }],
          agent.modelId, provider.baseUrl, provider.apiKey, agent.thinkingEnabled, abortSignal,
          (thinking, content) => {
            // Live streaming updates
            setLiveStreamText(content.slice(-200));
            updateStep(stepId, {
              thinking: thinking || undefined,
              content: content,
              title: `Step ${iter}: ${thinking ? "Thinking..." : "Typing..."}`,
            });
          },
        );
        agentThinking = result.thinking;
        agentOutput = result.content;
      } catch (error) {
        if ((error as Error).name === "AbortError") throw error;
        addStep({
          id: generateId(), agentId: agent.id, agentName: agent.name, type: "error",
          title: `Step ${iter}: Error`, content: error instanceof Error ? error.message : "Unknown error",
          timestamp: Date.now(), duration: Date.now() - stepStart,
        });
        throw error;
      }

      const stepDuration = Date.now() - stepStart;
      updateStep(stepId, {
        thinking: agentThinking || undefined,
        content: agentOutput,
        duration: stepDuration,
        title: `Step ${iter}: ${agentThinking ? "Thinking..." : "Responding..."}`,
      });
      currentLiveStepIdRef.current = null;
      setLiveStreamText("");

      // User intervention check
      const currentIntervention = pendingIntervention;
      if (currentIntervention) {
        setPendingIntervention(null);
        addStep({
          id: generateId(), agentId: "user", agentName: "You", type: "user_intervention",
          title: "User intervention", content: currentIntervention, timestamp: Date.now(),
        });
        currentInput = `User intervention: ${currentIntervention}\n\nContinue: ${task}`;
        observations.push(`[User says]: ${currentIntervention}`);
        continue;
      }

      const action = parseWorkerActionFull(agentThinking, agentOutput);

      if (action?.type === "search") {
        const searchStepId = generateId();
        addStep({
          id: searchStepId, agentId: agent.id, agentName: agent.name, type: "searching",
          title: `Searching: "${action.value}"`, content: "", timestamp: Date.now(), urls: [],
        });
        const searchStart = Date.now();
        const searchResults = await searchWeb(action.value, agent.searchLimit || 5);
        updateStep(searchStepId, {
          content: `Found ${searchResults.length} results`,
          searchResults: searchResults.length > 0 ? searchResults : undefined,
          urls: searchResults.map(r => r.url), duration: Date.now() - searchStart,
        });
        const searchContext = searchResults.map((r, i) =>
          r.content ? `[${i + 1}] ${r.title}\nURL: ${r.url}\n\nPage Content:\n${r.content}` : `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.snippet}`
        ).join("\n\n---\n\n");
        observations.push(`[Search: "${action.value}"]\n${searchContext}`);
        addToKnowledge(`[${agent.name} searched: "${action.value}"]\n${searchContext}`);
        currentInput = `Search results for "${action.value}":\n\n${searchContext}\n\nContinue: ${task}`;
        continue;
      } else if (action?.type === "read") {
        const readStepId = generateId();
        addStep({
          id: readStepId, agentId: agent.id, agentName: agent.name, type: "reading",
          title: `Reading: ${action.value}`, content: "", timestamp: Date.now(), urls: [action.value],
        });
        const readStart = Date.now();
        const pageContent = await readUrl(action.value);
        updateStep(readStepId, {
          content: pageContent.slice(0, 1000) + (pageContent.length > 1000 ? "..." : ""),
          duration: Date.now() - readStart,
        });
        observations.push(`[Read: ${action.value}]\n${pageContent}`);
        addToKnowledge(`[${agent.name} read: ${action.value}]\n${pageContent.slice(0, 2000)}`);
        currentInput = `Page content from ${action.value}:\n\n${pageContent}\n\nContinue: ${task}`;
        continue;
      } else {
        const finalContent = action?.type === "final" ? action.value : agentOutput;
        addStep({
          id: generateId(), agentId: agent.id, agentName: agent.name, type: "final",
          title: `Completed`, content: finalContent, thinking: agentThinking || undefined,
          timestamp: Date.now(), duration: stepDuration,
        });
        addToKnowledge(`[${agent.name} output]:\n${finalContent}`);
        return finalContent;
      }
    }

    const lastOutput = observations.join("\n\n");
    addStep({
      id: generateId(), agentId: agent.id, agentName: agent.name, type: "final",
      title: `Max steps reached`, content: lastOutput || "No output.", timestamp: Date.now(),
    });
    return lastOutput || "No output produced.";
  }, [providers, searchWeb, readUrl, addStep, updateStep, addToKnowledge, checkMaxSteps, pendingIntervention]);

  // --- Run the Manager's continuous loop ---
  const startResearch = useCallback(async () => {
    if (agents.length === 0) { toast({ title: "No agents", description: "Add a Manager + workers", variant: "destructive" }); return; }
    if (!topic.trim()) { toast({ title: "No topic", description: "Enter a research topic", variant: "destructive" }); return; }
    const manager = agents.find((a) => a.role === "manager");
    if (!manager) { toast({ title: "No Manager", description: "Add a Manager agent", variant: "destructive" }); return; }

    // Clear ALL previous state properly
    setIsRunning(true);
    setTotalSteps(0);
    totalStepsRef.current = 0;
    setFinalOutput("");
    setSteps([]);
    knowledgeBaseRef.current = [];
    taskTrackerRef.current = [];
    setPendingIntervention(null);
    setLiveStreamText("");
    currentLiveStepIdRef.current = null;
    setActiveTab("activity");

    const convId = createSwarmConversation(
      topic,
      agents.map((a) => ({ name: a.name, role: a.role, modelId: a.modelId, providerId: a.providerId, thinkingEnabled: a.thinkingEnabled })),
      maxSteps,
    );
    setSwarmConversationId(convId);

    addMessage(convId, {
      id: generateId(), role: "user", content: `🐝 Swarm Topic: ${topic}`, timestamp: Date.now(),
    });

    const controller = new AbortController();
    abortRef.current = controller;

    const workerAgents = agents.filter((a) => a.role !== "manager");
    const isSoloMode = workerAgents.length === 0;
    const agentRoster = workerAgents.map((a) => `- ${a.name} (role: ${a.role}${a.searchEnabled ? ", can search" : ""})`).join("\n");
    const managerProvider = providers.find((p) => p.id === manager.providerId);
    const maxManagerSteps = manager.maxIterations || 0;
    let managerStep = 0;
    let managerObservations: string[] = [];

    try {
      let managerInput = topic;

      while (maxManagerSteps === 0 || managerStep < maxManagerSteps) {
        if (controller.signal.aborted) break;
        if (checkMaxSteps()) break;
        managerStep++;

        const stepId = generateId();
        currentLiveStepIdRef.current = stepId;
        setLiveStreamText("");
        addStep({
          id: stepId, agentId: manager.id, agentName: manager.name, type: "thinking",
          title: `Manager step ${managerStep}: Planning...`, content: "", timestamp: Date.now(),
        });

        const stepStart = Date.now();

        const taskTrackerText = getTaskTrackerText();
        
        // Build dynamic system prompt based on solo vs team mode
        let managerSystemPrompt: string;
        if (isSoloMode) {
          // SOLO MODE: Manager is a full autonomous researcher
          managerSystemPrompt = `You are an autonomous research agent working ALONE. You have no team members — you must do ALL research yourself.

ACTIONS (you MUST output EXACTLY ONE per response):
- [CHAT: message] — Talk to the user and WAIT for their response. The loop PAUSES. Use to ask questions, propose plans, give updates.
- [SEARCH: query] — Search the web for information (do MULTIPLE searches with different queries!)
- [READ: url] — Read a web page for detailed content
- [SYNTHESIZE] — Combine all your findings into a coherent summary
- [FINAL: comprehensive answer] — Deliver the final answer with all research findings and sources

STRATEGY (follow this exact order):
1. [CHAT: ...] — Ask the user clarifying questions about their request
2. WAIT for user response
3. [SEARCH: query1] — Search for information (use 3-5+ DIFFERENT queries to get comprehensive results from 30-50+ sources)
4. [READ: url] — Read the most promising pages for deeper content (read 3-5+ pages)
5. If more research needed, search more with different queries or read more pages
6. [SYNTHESIZE] — Combine all findings
7. [FINAL: answer] — Deliver comprehensive answer with sources

CRITICAL RULES:
- You MUST include an action tag in EVERY response
- Do NOT use [FINAL: answer] until you have done at least 2-3 searches and read some pages
- Be THOROUGH — search multiple diverse queries, read multiple pages
- Aim for comprehensive coverage: 20-50+ sources, Reddit, news sites, expert opinions, data
- Include specific data, numbers, quotes, and source URLs

MANAGER STEP: ${managerStep}${maxManagerSteps > 0 ? ` / ${maxManagerSteps}` : " (unlimited)"}
${managerObservations.length > 0 ? `\nACCUMULATED KNOWLEDGE:\n${managerObservations.join("\n\n")}` : ""}`;
        } else {
          // TEAM MODE: Manager coordinates workers
          managerSystemPrompt = `${manager.systemPrompt || getDefaultSystemPrompt("manager")}

YOUR TEAM:
${agentRoster}

TASK TRACKER (current status of all delegated tasks):
${taskTrackerText}

AVAILABLE ACTIONS (you MUST output EXACTLY ONE per response):
- [CHAT: message] — Talk to the user and WAIT for their response. The loop PAUSES. Use to ask questions, propose plans, give updates.
- [DELEGATE: agent_name | task] — Assign a research task to a team member. They will search/read and report back.
- [SEARCH: query] — Search the web yourself (when you need to research directly)
- [READ: url] — Read a web page for detailed content
- [SYNTHESIZE] — Combine all agent findings into a coherent summary
- [FINAL: answer] — Deliver the final comprehensive answer with all research findings

CRITICAL REMINDERS:
- You MUST include an action tag in EVERY response
- Do NOT provide the final answer until research has been done
- Always DELEGATE research tasks or do research yourself before using [FINAL: answer]
- If this is your first step, use [CHAT: ...] to talk to the user first

MANAGER STEP: ${managerStep}${maxManagerSteps > 0 ? ` / ${maxManagerSteps}` : " (unlimited)"}
${managerObservations.length > 0 ? `\nACCUMULATED KNOWLEDGE:\n${managerObservations.join("\n\n")}` : ""}`;
        }

        let managerThinking = "";
        let managerOutput = "";

        try {
          const result = await callLLMStream(
            [{ role: "system", content: managerSystemPrompt }, { role: "user", content: managerInput }],
            manager.modelId, managerProvider?.baseUrl || "", managerProvider?.apiKey || "",
            manager.thinkingEnabled, controller.signal,
            (thinking, content) => {
              setLiveStreamText(content.slice(-200));
              updateStep(stepId, {
                thinking: thinking || undefined,
                content: content,
                title: `Manager step ${managerStep}: ${thinking ? "Thinking..." : "Typing..."}`,
              });
            },
          );
          managerThinking = result.thinking;
          managerOutput = result.content;
        } catch (error) {
          if ((error as Error).name === "AbortError") break;
          addStep({
            id: generateId(), agentId: manager.id, agentName: manager.name, type: "error",
            title: `Manager error`, content: error instanceof Error ? error.message : "Unknown",
            timestamp: Date.now(), duration: Date.now() - stepStart,
          });
          break;
        }

        const stepDuration = Date.now() - stepStart;
        updateStep(stepId, {
          thinking: managerThinking || undefined,
          content: managerOutput,
          duration: stepDuration,
          title: `Manager step ${managerStep}: Done`,
        });
        currentLiveStepIdRef.current = null;
        setLiveStreamText("");

        // User intervention
        const currentIntervention = pendingIntervention;
        if (currentIntervention) {
          setPendingIntervention(null);
          addStep({
            id: generateId(), agentId: "user", agentName: "You", type: "user_intervention",
            title: "User intervention", content: currentIntervention, timestamp: Date.now(),
          });
          managerObservations.push(`[User says]: ${currentIntervention}`);
          managerInput = `User intervention: ${currentIntervention}\n\nContinue. Topic: ${topic}`;
          continue;
        }

        const action = parseManagerActionFull(managerThinking, managerOutput);

        if (action?.type === "chat") {
          // Show the manager's chat message as a step
          addStep({
            id: generateId(), agentId: manager.id, agentName: manager.name, type: "chat",
            title: `💬 ${action.value!.slice(0, 60)}${action.value!.length > 60 ? "..." : ""}`,
            content: action.value!, thinking: managerThinking || undefined,
            timestamp: Date.now(), duration: stepDuration,
          });
          addMessage(convId, {
            id: generateId(), role: "assistant", content: action.value!,
            timestamp: Date.now(), model: manager.modelId, providerId: manager.providerId,
          });

          // NOW WAIT for user input instead of auto-continuing
          const waitingStepId = generateId();
          addStep({
            id: waitingStepId, agentId: "user", agentName: "You", type: "waiting_for_user",
            title: "⏳ Waiting for your response...", content: "", timestamp: Date.now(),
          });

          // Create a Promise that resolves when the user provides input
          const userInput = await new Promise<string>((resolve) => {
            waitForUserResolverRef.current = resolve;
            setIsWaitingForUser(true);
          });

          // User responded - update the waiting step
          updateStep(waitingStepId, {
            type: "user_intervention",
            title: "You responded",
            content: userInput,
            duration: 0,
          });
          setIsWaitingForUser(false);
          waitForUserResolverRef.current = null;

          managerObservations.push(`[Manager asked]: ${action.value}`);
          managerObservations.push(`[User responded]: ${userInput}`);
          managerInput = `The user responded to your question: "${userInput}"\n\nContinue based on their response. Topic: ${topic}`;
          continue;

        } else if (action?.type === "delegate" && action.agentName && action.task) {
          const targetAgent = agents.find((a) =>
            a.name.toLowerCase() === action.agentName!.toLowerCase() ||
            a.name.toLowerCase().includes(action.agentName!.toLowerCase()) ||
            action.agentName!.toLowerCase().includes(a.name.toLowerCase())
          );

          if (!targetAgent) {
            const notFoundMsg = `Agent "${action.agentName}" not found. Available: ${workerAgents.map((a) => a.name).join(", ")}`;
            addStep({
              id: generateId(), agentId: "system", agentName: "System", type: "error",
              title: `Agent not found: "${action.agentName}"`, content: notFoundMsg, timestamp: Date.now(),
            });
            managerObservations.push(`[System]: ${notFoundMsg}`);
            managerInput = notFoundMsg + "\n\nDelegate to an available agent.";
            continue;
          }

          // Track task
          const taskInfo: TaskInfo = { agentName: targetAgent.name, task: action.task, status: "running" };
          taskTrackerRef.current = [...taskTrackerRef.current, taskInfo];

          addStep({
            id: generateId(), agentId: manager.id, agentName: manager.name, type: "delegating",
            title: `→ ${targetAgent.name}: "${action.task.slice(0, 60)}${action.task.length > 60 ? "..." : ""}"`,
            content: action.task, thinking: managerThinking || undefined,
            timestamp: Date.now(), duration: stepDuration,
          });

          try {
            const workerResult = await runWorkerAgent(targetAgent, action.task, controller.signal);
            // Update task tracker
            taskTrackerRef.current = taskTrackerRef.current.map(t =>
              t.agentName === targetAgent.name && t.task === action.task && t.status === "running"
                ? { ...t, status: "completed", result: workerResult }
                : t
            );
            addMessage(convId, {
              id: generateId(), role: "assistant", content: `[${targetAgent.name}]: ${workerResult}`,
              timestamp: Date.now(), model: targetAgent.modelId, providerId: targetAgent.providerId,
            });
            managerObservations.push(`[${targetAgent.name} completed: "${action.task}"]\nResult:\n${workerResult}`);
            managerInput = `Agent ${targetAgent.name} completed their task. Result:\n\n${workerResult}\n\nDecide next action. Agents: ${agentRoster}`;
          } catch (error) {
            if ((error as Error).name === "AbortError") break;
            const errorMsg = error instanceof Error ? error.message : "Unknown";
            taskTrackerRef.current = taskTrackerRef.current.map(t =>
              t.agentName === targetAgent.name && t.task === action.task && t.status === "running"
                ? { ...t, status: "failed" }
                : t
            );
            managerObservations.push(`[${targetAgent.name} FAILED]: ${errorMsg}`);
            managerInput = `Agent ${targetAgent.name} failed: ${errorMsg}\n\nDecide next action.`;
          }
          continue;

        } else if (action?.type === "search") {
          const searchStepId = generateId();
          addStep({
            id: searchStepId, agentId: manager.id, agentName: manager.name, type: "searching",
            title: `Manager searching: "${action.query}"`, content: "", timestamp: Date.now(), urls: [],
          });
          const searchStart = Date.now();
          const searchLimit = manager.searchLimit || 25;
          const searchResults = await searchWeb(action.query!, searchLimit);
          updateStep(searchStepId, {
            content: `Found ${searchResults.length} results`,
            searchResults: searchResults.length > 0 ? searchResults : undefined,
            urls: searchResults.map(r => r.url), duration: Date.now() - searchStart,
          });
          const searchContext = searchResults.map((r, i) =>
            r.content ? `[${i + 1}] ${r.title}\nURL: ${r.url}\n\nPage Content:\n${r.content}` : `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.snippet}`
          ).join("\n\n---\n\n");
          managerObservations.push(`[Manager searched: "${action.query}"]\n${searchContext}`);
          addToKnowledge(`[Manager searched: "${action.query}"]\n${searchContext}`);
          managerInput = `Search results for "${action.query}":\n\n${searchContext}\n\n${isSoloMode ? "Continue researching. Use [SEARCH: ...] for more queries, [READ: url] to read promising pages, or [SYNTHESIZE] if you have enough data." : "Decide next action."}`;
          continue;

        } else if (action?.type === "read") {
          const readStepId = generateId();
          addStep({
            id: readStepId, agentId: manager.id, agentName: manager.name, type: "reading",
            title: `Manager reading: ${action.url}`, content: "", timestamp: Date.now(), urls: [action.url!],
          });
          const readStart = Date.now();
          const pageContent = await readUrl(action.url!);
          updateStep(readStepId, {
            content: pageContent.slice(0, 1000) + (pageContent.length > 1000 ? "..." : ""),
            duration: Date.now() - readStart,
          });
          managerObservations.push(`[Manager read: ${action.url}]\n${pageContent}`);
          addToKnowledge(`[Manager read: ${action.url}]\n${pageContent.slice(0, 3000)}`);
          managerInput = `Page content from ${action.url}:\n\n${pageContent}\n\n${isSoloMode ? "Continue researching. Use [SEARCH: ...] for more queries, [READ: url] to read more pages, or [SYNTHESIZE] if you have enough data." : "Decide next action."}`;
          continue;

        } else if (action?.type === "synthesize") {
          addStep({
            id: generateId(), agentId: manager.id, agentName: manager.name, type: "synthesizing",
            title: "Synthesizing all findings...", content: "", thinking: managerThinking || undefined,
            timestamp: Date.now(), duration: stepDuration,
          });
          const knowledge = getKnowledgeText();
          managerInput = `SYNTHESIZE all research into a comprehensive answer.\n\nALL DATA:\n${knowledge}\n\nProvide final answer with [FINAL: your answer].`;
          continue;

        } else if (action?.type === "final") {
          addStep({
            id: generateId(), agentId: manager.id, agentName: manager.name, type: "final",
            title: "✅ Final Answer", content: action.value!, thinking: managerThinking || undefined,
            timestamp: Date.now(), duration: stepDuration,
          });
          setFinalOutput(action.value!);
          updateSwarmOutput(convId, action.value!);
          addMessage(convId, {
            id: generateId(), role: "assistant", content: action.value!,
            timestamp: Date.now(), model: manager.modelId, providerId: manager.providerId,
          });
          break;

        } else {
          // No action tag — NEVER auto-finalize. Always require explicit [FINAL: answer].
          // If the output is substantial and looks like a final answer, prompt the manager to use [FINAL: ...]
          if (managerOutput.length > 100 && managerObservations.length > 0) {
            // The manager produced substantial output without an action tag.
            // Prompt them to wrap it in [FINAL: ...] or continue delegating.
            managerObservations.push(`[Manager output (no action tag)]: ${managerOutput.slice(0, 500)}`);
            managerInput = `Your previous response did not include an action tag. You MUST include one of: [CHAT: msg], [DELEGATE: agent | task], [SEARCH: query], [READ: url], [SYNTHESIZE], or [FINAL: answer].\n\nIf you're ready to deliver the final answer, use [FINAL: your complete answer].\nIf you need to research more, use [SEARCH: query] or [READ: url].\nIf you want to ask the user something, use [CHAT: your question].\n\n${isSoloMode ? "You are working alone — use [SEARCH: ...] and [READ: ...] to research." : `Agents: ${agentRoster}`}\nTopic: ${topic}`;
            continue;
          }
          managerInput = `Please use an action tag: [CHAT: msg], [DELEGATE: agent | task], [SEARCH: query], [READ: url], [SYNTHESIZE], or [FINAL: answer].\n\n${isSoloMode ? "You are working alone — use [SEARCH: ...] and [READ: ...] to research." : `Agents: ${agentRoster}`}\nTopic: ${topic}`;
          continue;
        }
      }

    } catch (error) {
      console.error("Research error:", error);
    } finally {
      if (waitForUserResolverRef.current) {
        waitForUserResolverRef.current("Research ended");
        waitForUserResolverRef.current = null;
      }
      setIsWaitingForUser(false);
      setIsRunning(false);
      abortRef.current = null;
      currentLiveStepIdRef.current = null;
      setLiveStreamText("");
    }
  }, [agents, topic, maxSteps, providers, searchWeb, readUrl, addStep, updateStep, addToKnowledge, getKnowledgeText, getTaskTrackerText, checkMaxSteps, runWorkerAgent, createSwarmConversation, addMessage, updateSwarmOutput]);

  const stopResearch = () => {
    if (waitForUserResolverRef.current) {
      waitForUserResolverRef.current("Research was stopped");
      waitForUserResolverRef.current = null;
    }
    setIsWaitingForUser(false);
    if (abortRef.current) abortRef.current.abort();
    setIsRunning(false);
    setLiveStreamText("");
  };

  const handleIntervention = () => {
    if (!userIntervention.trim()) return;
    setPendingIntervention(userIntervention.trim());
    setUserIntervention("");
    toast({ title: "Intervention queued", description: "Will be injected at the next step" });
  };

  if (enabledProviders.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="max-w-sm w-full text-center space-y-4">
          <div className="mx-auto w-16 h-16 rounded-2xl bg-muted flex items-center justify-center">
            <FlaskConical className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold">Agentic Swarm</h3>
          <p className="text-sm text-muted-foreground">Add at least one AI provider in Settings</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 h-0">
      {/* Header */}
      <div className="shrink-0 border-b px-2 md:px-3 py-2 bg-background/95 backdrop-blur">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center">
              <Zap className="h-3.5 w-3.5 text-white" />
            </div>
            <div>
              <h2 className="text-xs font-semibold bg-gradient-to-r from-violet-600 to-fuchsia-600 dark:from-violet-400 dark:to-fuchsia-400 bg-clip-text text-transparent">
                Agentic Swarm
              </h2>
              <p className="text-[9px] text-muted-foreground">Manager-driven · Continuous loop</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Button variant={showConfig ? "secondary" : "ghost"} size="sm" className="h-6 gap-1 text-[10px] px-2" onClick={() => setShowConfig(!showConfig)}>
              {showConfig ? <PanelLeftClose className="h-3 w-3" /> : <PanelLeft className="h-3 w-3" />}
            </Button>
            {isRunning && (
              <Badge variant="outline" className="text-[9px] gap-0.5 border-amber-500/30 text-amber-600 px-1.5 py-0">
                <Loader2 className="h-2.5 w-2.5 animate-spin" /> Step {totalSteps}{maxSteps > 0 ? `/${maxSteps}` : ""}
              </Badge>
            )}
            {!isRunning && finalOutput && (
              <Badge variant="outline" className="text-[9px] gap-0.5 border-emerald-500/30 text-emerald-600 px-1.5 py-0">
                <Check className="h-2.5 w-2.5" /> Done
              </Badge>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 flex min-h-0 relative">
        {/* Left Panel: Config - responsive layout */}
        {showConfig && (
        <>
          {/* Mobile backdrop */}
          <div className="fixed inset-0 bg-black/40 z-10 md:hidden" onClick={() => setShowConfig(false)} />
          <div className="w-[85vw] md:w-72 shrink-0 border-r flex flex-col min-h-0 fixed md:relative z-20 md:z-10 bg-background h-full shadow-lg md:shadow-none top-0 md:top-auto left-0">
          <div ref={configScrollRef} className="flex-1 min-h-0 overflow-y-auto">
            <div className="p-3 space-y-3">
              {/* Topic */}
              <div className="space-y-1">
                <Label className="text-[10px] font-semibold">Research Topic</Label>
                <Textarea value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. Best AI stocks 2025..." className="min-h-[50px] text-xs resize-none" disabled={isRunning} rows={2} />
              </div>

              {/* Max Steps */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-[10px] font-semibold">Max Steps</Label>
                  <span className="text-[10px] font-mono text-muted-foreground">{maxSteps === 0 ? "∞" : maxSteps}</span>
                </div>
                <Slider value={[maxSteps]} onValueChange={([v]) => setMaxSteps(v)} min={0} max={50} step={1} disabled={isRunning} />
              </div>

              <Separator />

              {/* Agents */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-[10px] font-semibold flex items-center gap-1"><Users className="h-3 w-3" /> Team</Label>
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" onClick={() => addAgent("researcher")} disabled={isRunning} className="h-5 text-[9px] px-1.5">
                      <Plus className="h-2.5 w-2.5" /> Researcher
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => addAgent("analyst")} disabled={isRunning} className="h-5 text-[9px] px-1.5">
                      <Plus className="h-2.5 w-2.5" /> Analyst
                    </Button>
                  </div>
                </div>

                {!managerAgent && (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-50/50 dark:bg-amber-950/10 p-2 space-y-1.5">
                    <div className="flex items-center gap-1 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                      <Crown className="h-3 w-3" /> Manager Required
                    </div>
                    <p className="text-[9px] text-muted-foreground">Orchestrates the swarm</p>
                    <Button size="sm" variant="outline" onClick={() => {
                      const fp = enabledProviders[0];
                      const fm = fp?.models[0];
                      setAgents([{
                        id: generateId(), name: "Manager", role: "manager",
                        systemPrompt: getDefaultSystemPrompt("manager"),
                        modelId: fm?.id || "", providerId: fp?.id || "",
                        searchEnabled: true, searchLimit: 25, priority: 10,
                        thinkingEnabled: true, maxIterations: 0,
                      }, ...agents]);
                    }} disabled={isRunning} className="h-6 text-[9px] gap-0.5 w-full border-amber-500/40 text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/20">
                      <Crown className="h-2.5 w-2.5" /> Add Manager
                    </Button>
                  </div>
                )}

                {agents.length === 0 ? (
                  <div className="rounded-lg border border-dashed p-4 text-center">
                    <Bot className="h-6 w-6 mx-auto text-muted-foreground/30 mb-1" />
                    <p className="text-[10px] text-muted-foreground">Add Manager + workers</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {agents.map((agent, i) => (
                      <AgentConfigCard key={agent.id} agent={agent} index={i} onUpdate={updateAgent} onRemove={removeAgent}
                        providers={enabledProviders.map((p) => ({ id: p.id, name: p.name, models: p.models }))} />
                    ))}
                  </div>
                )}

                <div className="flex items-center gap-1 flex-wrap">
                  <Button size="sm" variant="ghost" onClick={() => addAgent("writer")} disabled={isRunning} className="h-5 text-[9px] px-1.5 text-muted-foreground">
                    <Plus className="h-2.5 w-2.5" /> Writer
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => addAgent("coder")} disabled={isRunning} className="h-5 text-[9px] px-1.5 text-muted-foreground">
                    <Plus className="h-2.5 w-2.5" /> Coder
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => addAgent("custom")} disabled={isRunning} className="h-5 text-[9px] px-1.5 text-muted-foreground">
                    <Plus className="h-2.5 w-2.5" /> Custom
                  </Button>
                </div>
              </div>

              {/* Search status */}
              <div className="rounded-lg bg-muted/50 p-2">
                <div className="flex items-center gap-1.5 text-[10px]">
                  <Globe className="h-3 w-3" />
                  <span className="font-medium">Search</span>
                  {activeSearchProvider ? (
                    <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5 border-emerald-500/30 text-emerald-600">{activeSearchProvider.name}</Badge>
                  ) : (
                    <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5 border-destructive/30 text-destructive">None</Badge>
                  )}
                </div>
              </div>

              {/* Controls */}
              <div className="flex items-center gap-1.5">
                {!isRunning ? (
                  <>
                    <Button className="flex-1 gap-1.5 bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:from-violet-600 hover:to-fuchsia-600 text-white h-8 text-xs" onClick={startResearch} disabled={!managerAgent || !topic.trim()}>
                      <Play className="h-3.5 w-3.5" /> Start
                    </Button>
                    <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={resetSwarm} title="Reset swarm">
                      <RotateCcw className="h-3.5 w-3.5" />
                    </Button>
                  </>
                ) : (
                  <Button variant="destructive" className="flex-1 gap-1.5 h-8 text-xs" onClick={stopResearch}>
                    <Square className="h-3.5 w-3.5" /> Stop
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
        </>
        )}

        {/* Right Panel: Activity */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Tabs */}
          <div className="shrink-0 border-b px-3 pt-1.5 flex items-center gap-3">
            <button onClick={() => setActiveTab("activity")} className={`text-[10px] font-medium pb-1.5 border-b-2 transition-colors ${activeTab === "activity" ? "border-fuchsia-500 text-fuchsia-600 dark:text-fuchsia-400" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
              <Activity className="h-3 w-3 inline mr-0.5" /> Activity
              {steps.length > 0 && <Badge variant="secondary" className="ml-0.5 text-[7px] px-0.5 py-0 h-3">{steps.length}</Badge>}
            </button>
            <button onClick={() => setActiveTab("agents")} className={`text-[10px] font-medium pb-1.5 border-b-2 transition-colors ${activeTab === "agents" ? "border-fuchsia-500 text-fuchsia-600 dark:text-fuchsia-400" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
              <Bot className="h-3 w-3 inline mr-0.5" /> Agents
            </button>
            <button onClick={() => setActiveTab("output")} className={`text-[10px] font-medium pb-1.5 border-b-2 transition-colors ${activeTab === "output" ? "border-fuchsia-500 text-fuchsia-600 dark:text-fuchsia-400" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
              <Eye className="h-3 w-3 inline mr-0.5" /> Output
            </button>
          </div>

          <div ref={activityScrollRef} className="flex-1 min-h-0 overflow-y-auto">
            <div className="p-3">
              {activeTab === "activity" && (
                <div className="space-y-0">
                  {steps.length === 0 ? (
                    <div className="py-12 text-center space-y-2">
                      <div className="mx-auto w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-500/10 to-fuchsia-500/10 flex items-center justify-center">
                        <Zap className="h-7 w-7 text-fuchsia-500/30" />
                      </div>
                      <p className="text-xs text-muted-foreground">Configure your swarm and hit Start</p>
                      <p className="text-[10px] text-muted-foreground/60 max-w-xs mx-auto">
                        Manager chats with you → delegates → workers search &amp; read → manager synthesizes → final answer
                      </p>
                    </div>
                  ) : (
                    steps.map((step, i) => {
                      const agentIdx = agents.findIndex((a) => a.id === step.agentId);
                      const color = step.agentId === "user" ? "#8b5cf6" : step.agentId === "system" ? "#6b7280" : getAgentColor(agents[agentIdx] || { role: "custom" } as AgentConfig, agentIdx >= 0 ? agentIdx : 0);
                      return <StepCard key={step.id} step={step} agentColor={color} isLast={i === steps.length - 1} />;
                    })
                  )}
                  {/* Live streaming indicator */}
                  {isRunning && liveStreamText && (
                    <div className="flex gap-3 mt-2">
                      <div className="flex flex-col items-center shrink-0">
                        <div className="h-7 w-7 rounded-full border-2 border-fuchsia-500/50 bg-fuchsia-500/10 flex items-center justify-center animate-pulse">
                          <Loader2 className="h-3.5 w-3.5 text-fuchsia-500 animate-spin" />
                        </div>
                      </div>
                      <div className="flex-1 rounded-lg border border-fuchsia-500/20 bg-fuchsia-50/30 dark:bg-fuchsia-950/10 p-2">
                        <div className="flex items-center gap-1 text-[10px]">
                          <span className="text-fuchsia-600 dark:text-fuchsia-400 font-semibold">Live</span>
                          <span className="text-muted-foreground text-[9px]">typing...</span>
                        </div>
                        <p className="text-[10px] text-foreground/70 mt-0.5 whitespace-pre-wrap break-words line-clamp-3">{liveStreamText}</p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {activeTab === "agents" && (
                <div className="space-y-2">
                  {agents.length === 0 ? (
                    <div className="py-12 text-center">
                      <Bot className="h-8 w-8 mx-auto text-muted-foreground/20 mb-2" />
                      <p className="text-xs text-muted-foreground">Add agents in config panel</p>
                    </div>
                  ) : (
                    agents.map((agent, i) => {
                      const agentSteps = steps.filter((s) => s.agentId === agent.id);
                      const searchSteps = agentSteps.filter((s) => s.type === "searching");
                      const readSteps = agentSteps.filter((s) => s.type === "reading");
                      const delegateSteps = agentSteps.filter((s) => s.type === "delegating");
                      const totalDuration = agentSteps.reduce((acc, s) => acc + (s.duration || 0), 0);
                      const isManager = agent.role === "manager";
                      return (
                        <Card key={agent.id} className={`border-l-4 ${isManager ? "ring-1 ring-amber-500/20" : ""}`} style={{ borderLeftColor: getAgentColor(agent, i) }}>
                          <CardContent className="p-3 space-y-1.5">
                            <div className="flex items-center gap-1.5">
                              <div className="h-6 w-6 rounded flex items-center justify-center text-white text-[10px] font-bold" style={{ backgroundColor: getAgentColor(agent, i) }}>
                                {isManager ? <Crown className="h-3 w-3" /> : i + 1}
                              </div>
                              <span className="text-xs font-medium">{agent.name}</span>
                              <Badge variant="outline" className={`text-[9px] px-1 py-0 h-3.5 ${getRoleBadgeStyle(agent.role)}`}>
                                <RoleIcon role={agent.role} /> <span className="ml-0.5 capitalize">{agent.role}</span>
                              </Badge>
                            </div>
                            <div className={`grid ${isManager ? "grid-cols-5" : "grid-cols-4"} gap-1.5 text-[9px]`}>
                              <div className="rounded bg-muted p-1.5 text-center"><div className="font-semibold">{agentSteps.length}</div><div className="text-muted-foreground">Steps</div></div>
                              {isManager && <div className="rounded bg-muted p-1.5 text-center"><div className="font-semibold">{delegateSteps.length}</div><div className="text-muted-foreground">Delegated</div></div>}
                              <div className="rounded bg-muted p-1.5 text-center"><div className="font-semibold">{searchSteps.length}</div><div className="text-muted-foreground">Searches</div></div>
                              <div className="rounded bg-muted p-1.5 text-center"><div className="font-semibold">{readSteps.length}</div><div className="text-muted-foreground">Reads</div></div>
                              <div className="rounded bg-muted p-1.5 text-center"><div className="font-semibold">{(totalDuration / 1000).toFixed(1)}s</div><div className="text-muted-foreground">Time</div></div>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })
                  )}
                </div>
              )}

              {activeTab === "output" && (
                <div className="space-y-3">
                  {finalOutput ? (
                    <div className="prose prose-sm dark:prose-invert max-w-none">
                      <ReactMarkdown>{finalOutput}</ReactMarkdown>
                    </div>
                  ) : (
                    <div className="py-12 text-center">
                      <FileText className="h-8 w-8 mx-auto text-muted-foreground/20 mb-2" />
                      <p className="text-xs text-muted-foreground">Final answer appears here when manager delivers it</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* User Input - always visible when running */}
          {isRunning && (
            <div className="shrink-0 border-t bg-background p-2">
              {isWaitingForUser ? (
                <>
                  <Label className="text-[9px] text-amber-600 dark:text-amber-400 mb-1 block font-medium flex items-center gap-1">
                    <MessageCircle className="h-3 w-3" /> 💬 Respond to Manager
                  </Label>
                  <div className="flex items-center gap-1.5">
                    <Input
                      value={userIntervention}
                      onChange={(e) => setUserIntervention(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          const msg = userIntervention.trim();
                          if (msg && waitForUserResolverRef.current) {
                            waitForUserResolverRef.current(msg);
                            setUserIntervention("");
                          }
                        }
                      }}
                      placeholder="Type your response..."
                      className="h-8 text-xs border-amber-500/40 focus-visible:ring-amber-500/30"
                      autoFocus
                    />
                    <Button
                      size="icon"
                      className="h-8 w-8 shrink-0 bg-amber-500 hover:bg-amber-600 text-white"
                      onClick={() => {
                        const msg = userIntervention.trim();
                        if (msg && waitForUserResolverRef.current) {
                          waitForUserResolverRef.current(msg);
                          setUserIntervention("");
                        }
                      }}
                      disabled={!userIntervention.trim()}
                    >
                      <Send className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 text-[9px] text-muted-foreground mt-1 gap-0.5"
                    onClick={() => {
                      if (waitForUserResolverRef.current) {
                        waitForUserResolverRef.current("go ahead");
                      }
                    }}
                  >
                    <ArrowRight className="h-2.5 w-2.5" /> Continue without input
                  </Button>
                </>
              ) : (
                <>
                  <Label className="text-[9px] text-muted-foreground mb-1 block">Intervene — injected at next step</Label>
                  <div className="flex items-center gap-1.5">
                    <Input
                      value={userIntervention}
                      onChange={(e) => setUserIntervention(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleIntervention(); } }}
                      placeholder="e.g. Focus on renewable energy..."
                      className="h-8 text-xs"
                      disabled={!!pendingIntervention}
                    />
                    <Button size="icon" className="h-8 w-8 shrink-0" onClick={handleIntervention} disabled={!userIntervention.trim() || !!pendingIntervention}>
                      <Send className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  {pendingIntervention && (
                    <p className="text-[9px] text-violet-600 dark:text-violet-400 mt-0.5 flex items-center gap-0.5">
                      <Loader2 className="h-2.5 w-2.5 animate-spin" /> Queued: &quot;{pendingIntervention}&quot;
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
