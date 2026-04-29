"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { useAppStore } from "@/lib/store";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Sparkles,
  Plus,
  Server,
  MessageSquare,
  Zap,
  ArrowRight,
  Key,
  Shield,
  CheckCircle2,
  Globe,
  Cpu,
  Layers,
  Settings,
  Bot,
  Lock,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Animation variants
// ---------------------------------------------------------------------------
const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.06, delayChildren: 0.05 },
  },
};

const item = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 260, damping: 20 } },
};

const cardHover = {
  rest: { scale: 1 },
  hover: { scale: 1.02, transition: { type: "spring", stiffness: 300, damping: 20 } },
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Small stat card used in the dashboard stats row */
function StatCard({
  icon: Icon,
  value,
  label,
  accent,
}: {
  icon: React.ElementType;
  value: string | number;
  label: string;
  accent: string;
}) {
  return (
    <motion.div variants={item}>
      <Card className="relative overflow-hidden border-border/40 bg-card/50 backdrop-blur-sm">
        <CardContent className="p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <p className="text-2xl sm:text-3xl font-bold tracking-tight">{value}</p>
              <p className="text-xs text-muted-foreground font-medium">{label}</p>
            </div>
            <div
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${accent}`}
            >
              <Icon className="h-4 w-4" />
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

/** A single clickable model card */
function ModelCard({
  modelId,
  modelName,
  providerName,
  ownedBy,
  onClick,
}: {
  modelId: string;
  modelName: string;
  providerName: string;
  ownedBy?: string;
  onClick: () => void;
}) {
  return (
    <motion.div variants={item} whileHover="hover" initial="rest" animate="rest">
      <motion.div variants={cardHover}>
        <Card
          className="group cursor-pointer border-border/40 bg-card/50 backdrop-blur-sm hover:border-amber-500/40 hover:bg-amber-500/[0.04] dark:hover:bg-amber-500/[0.06] transition-colors duration-200"
          onClick={onClick}
        >
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <Bot className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
                  <p className="text-sm font-semibold truncate leading-tight">
                    {modelName || modelId}
                  </p>
                </div>
                <p className="text-[11px] text-muted-foreground truncate pl-5.5">
                  {modelId}
                </p>
                <div className="flex items-center gap-1.5 pt-1 pl-5.5">
                  <span className="text-[10px] text-muted-foreground/70">
                    {providerName}
                  </span>
                  {ownedBy && (
                    <>
                      <span className="text-[10px] text-muted-foreground/30">·</span>
                      <span className="text-[10px] text-muted-foreground/50">
                        {ownedBy}
                      </span>
                    </>
                  )}
                </div>
              </div>
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted/60 text-muted-foreground/0 group-hover:text-amber-600 dark:group-hover:text-amber-400 group-hover:bg-amber-500/10 transition-all duration-200 mt-0.5">
                <ArrowRight className="h-3.5 w-3.5" />
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Empty State
// ---------------------------------------------------------------------------

function EmptyState({ onAddProvider }: { onAddProvider: () => void }) {
  return (
    <div className="flex-1 flex items-center justify-center p-6 sm:p-8">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 220, damping: 22 }}
        className="max-w-lg w-full"
      >
        <Card className="overflow-hidden border-border/40">
          {/* Gradient header */}
          <div className="relative bg-gradient-to-br from-amber-500/10 via-orange-500/5 to-transparent dark:from-amber-500/15 dark:via-orange-500/10 dark:to-transparent px-6 pt-10 pb-8 text-center">
            {/* Decorative circles */}
            <div className="pointer-events-none absolute -top-10 -right-10 h-40 w-40 rounded-full bg-amber-500/5 blur-2xl" />
            <div className="pointer-events-none absolute -bottom-10 -left-10 h-32 w-32 rounded-full bg-orange-500/5 blur-2xl" />

            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.1, type: "spring", stiffness: 200 }}
              className="relative mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 shadow-lg shadow-amber-500/20"
            >
              <Sparkles className="h-9 w-9 text-white" />
            </motion.div>

            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
              Welcome to NebChat
            </h2>
            <p className="mt-2 text-sm text-muted-foreground max-w-sm mx-auto leading-relaxed">
              Your private, bring-your-own-key AI chat interface. Connect any
              OpenAI-compatible provider and start chatting instantly.
            </p>
          </div>

          <CardContent className="p-6 space-y-6">
            {/* CTA Button */}
            <Button
              size="lg"
              className="w-full gap-2 bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white shadow-md shadow-amber-500/20 transition-all duration-200 h-12 text-base font-semibold"
              onClick={onAddProvider}
            >
              <Plus className="h-5 w-5" />
              Add Your First Provider
            </Button>

            {/* Feature badges */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { icon: Key, label: "BYOK", sublabel: "Your keys" },
                { icon: Shield, label: "Private", sublabel: "Browser only" },
                { icon: Zap, label: "Fast", sublabel: "Direct API" },
              ].map((feat) => (
                <div
                  key={feat.label}
                  className="flex flex-col items-center gap-1.5 rounded-lg bg-muted/40 p-3"
                >
                  <feat.icon className="h-5 w-5 text-muted-foreground" />
                  <span className="text-[11px] font-semibold">{feat.label}</span>
                  <span className="text-[9px] text-muted-foreground/60">
                    {feat.sublabel}
                  </span>
                </div>
              ))}
            </div>

            <Separator className="opacity-50" />

            {/* Supported providers */}
            <div className="text-center space-y-2">
              <p className="text-xs font-medium text-muted-foreground">
                Compatible Providers
              </p>
              <div className="flex flex-wrap justify-center gap-1.5">
                {[
                  "OpenAI",
                  "Groq",
                  "Together AI",
                  "Mistral",
                  "Ollama",
                  "DeepSeek",
                  "Anthropic",
                  "Cohere",
                ].map((name) => (
                  <Badge
                    key={name}
                    variant="secondary"
                    className="text-[10px] font-normal"
                  >
                    {name}
                  </Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main HomeView Component
// ---------------------------------------------------------------------------

export function HomeView() {
  const providers = useAppStore((s) => s.providers);
  const conversations = useAppStore((s) => s.conversations);
  const createConversation = useAppStore((s) => s.createConversation);
  const setSelectedModel = useAppStore((s) => s.setSelectedModel);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);

  const enabledProviders = useMemo(
    () => providers.filter((p) => p.isEnabled),
    [providers]
  );

  const allModels = useMemo(
    () =>
      enabledProviders.flatMap((p) =>
        p.models.map((m) => ({
          ...m,
          providerName: p.name,
          providerId: p.id,
        }))
      ),
    [enabledProviders]
  );

  const handleStartChat = (modelId: string, providerId: string) => {
    setSelectedModel(modelId, providerId);
    createConversation(modelId, providerId);
  };

  // ---- Empty state ----
  if (providers.length === 0) {
    return <EmptyState onAddProvider={() => setSettingsOpen(true)} />;
  }

  // ---- Dashboard ----
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8 space-y-8">
        {/* ── Hero Section ────────────────────────────────────────── */}
        <motion.section
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 240, damping: 22 }}
          className="relative overflow-hidden rounded-xl bg-gradient-to-br from-amber-500/[0.07] via-orange-500/[0.04] to-transparent dark:from-amber-500/[0.10] dark:via-orange-500/[0.06] border border-amber-500/10 p-5 sm:p-6 lg:p-8"
        >
          {/* Decorative blurs */}
          <div className="pointer-events-none absolute -top-16 -right-16 h-48 w-48 rounded-full bg-amber-500/10 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-12 -left-12 h-36 w-36 rounded-full bg-orange-500/10 blur-3xl" />

          <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 shadow-md shadow-amber-500/20">
                <Sparkles className="h-5 w-5 text-white" />
              </div>
              <div>
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
                  NebChat
                </h1>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Choose a model and start chatting
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 self-start sm:self-auto border-amber-500/20 hover:border-amber-500/40 hover:bg-amber-500/5 text-amber-700 dark:text-amber-400"
              onClick={() => setSettingsOpen(true)}
            >
              <Plus className="h-3.5 w-3.5" />
              Add Provider
            </Button>
          </div>
        </motion.section>

        {/* ── Stats Row ───────────────────────────────────────────── */}
        <motion.section
          variants={container}
          initial="hidden"
          animate="show"
          className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4"
        >
          <StatCard
            icon={Server}
            value={providers.length}
            label="Providers"
            accent="bg-amber-500/10 text-amber-600 dark:text-amber-400"
          />
          <StatCard
            icon={Cpu}
            value={allModels.length}
            label="Models"
            accent="bg-orange-500/10 text-orange-600 dark:text-orange-400"
          />
          <StatCard
            icon={MessageSquare}
            value={conversations.length}
            label="Conversations"
            accent="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          />
          <StatCard
            icon={Lock}
            value="100%"
            label="Private"
            accent="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          />
        </motion.section>

        {/* ── Privacy Banner ──────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25, type: "spring", stiffness: 220, damping: 22 }}
        >
          <Card className="border-emerald-500/20 bg-emerald-500/[0.04] dark:bg-emerald-500/[0.06]">
            <CardContent className="flex items-center gap-3 p-3.5 sm:p-4">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                  100% Private — Your keys stay in your browser
                </p>
                <p className="text-xs text-emerald-600/60 dark:text-emerald-400/50">
                  API keys are stored locally and never sent to any server.
                </p>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* ── Models by Provider ──────────────────────────────────── */}
        {enabledProviders.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="flex flex-col items-center justify-center py-16 space-y-4 text-center"
          >
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted/50">
              <Server className="h-8 w-8 text-muted-foreground/40" />
            </div>
            <div className="space-y-1">
              <p className="text-base font-semibold text-muted-foreground">
                No active providers
              </p>
              <p className="text-sm text-muted-foreground/60 max-w-xs mx-auto">
                Enable a provider or add a new one to start chatting with AI
                models.
              </p>
            </div>
            <Button
              onClick={() => setSettingsOpen(true)}
              className="gap-2 bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white"
            >
              <Settings className="h-4 w-4" />
              Open Settings
            </Button>
          </motion.div>
        ) : (
          <div className="space-y-8">
            {enabledProviders.map((provider, providerIndex) => (
              <motion.section
                key={provider.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  delay: 0.15 + providerIndex * 0.08,
                  type: "spring",
                  stiffness: 220,
                  damping: 22,
                }}
                className="space-y-3"
              >
                {/* Provider header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-6 w-6 items-center justify-center rounded-md bg-emerald-500/10">
                      <Globe className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <h3 className="text-sm font-semibold tracking-tight">
                      {provider.name}
                    </h3>
                    <Badge
                      variant="secondary"
                      className="text-[10px] h-5 px-1.5 font-medium"
                    >
                      <Layers className="h-2.5 w-2.5 mr-0.5" />
                      {provider.models.length} models
                    </Badge>
                    <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setSettingsOpen(true)}
                  >
                    Manage
                  </Button>
                </div>

                {/* Model grid */}
                <motion.div
                  variants={container}
                  initial="hidden"
                  animate="show"
                  className="grid gap-2.5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
                >
                  {provider.models.map((model) => (
                    <ModelCard
                      key={model.id}
                      modelId={model.id}
                      modelName={model.name || model.id}
                      providerName={provider.name}
                      ownedBy={model.owned_by}
                      onClick={() => handleStartChat(model.id, provider.id)}
                    />
                  ))}
                </motion.div>
              </motion.section>
            ))}
          </div>
        )}

        {/* ── Quick Tips ──────────────────────────────────────────── */}
        {allModels.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
          >
            <Card className="border-border/30 bg-muted/20">
              <CardContent className="p-4 sm:p-5">
                <div className="flex items-start gap-3">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-500/10">
                    <Zap className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div className="space-y-2">
                    <h4 className="text-xs font-semibold">Quick Tips</h4>
                    <ul className="text-[11px] text-muted-foreground space-y-1 leading-relaxed">
                      <li className="flex items-start gap-1.5">
                        <span className="text-amber-500/60 mt-0.5">•</span>
                        Click any model card above to start a new conversation
                      </li>
                      <li className="flex items-start gap-1.5">
                        <span className="text-amber-500/60 mt-0.5">•</span>
                        Use the sidebar to switch between conversations
                      </li>
                      <li className="flex items-start gap-1.5">
                        <span className="text-amber-500/60 mt-0.5">•</span>
                        Your chat history is saved in your browser automatically
                      </li>
                      <li className="flex items-start gap-1.5">
                        <span className="text-amber-500/60 mt-0.5">•</span>
                        Add more providers anytime from Settings
                      </li>
                    </ul>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </div>
    </div>
  );
}
