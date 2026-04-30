"use client";

import { useAppStore } from "@/lib/store";
import * as storage from "@/lib/storage";
import { ModelInfo, SearchProviderType } from "@/lib/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Plus,
  Trash2,
  Key,
  Server,
  RefreshCw,
  Check,
  Eye,
  EyeOff,
  Loader2,
  Globe,
  Zap,
  Settings,
  Search,
  FileText,
  BookOpen,
  Shield,
  ChevronDown,
  ChevronUp,
  Bot,
  Crown,
  Brain,
  Users,
} from "lucide-react";
import { useState, useCallback } from "react";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// ---------------------------------------------------------------------------
// Form Types
// ---------------------------------------------------------------------------

interface AddProviderForm {
  name: string;
  baseUrl: string;
  apiKey: string;
}

interface AddSearchProviderForm {
  name: string;
  type: SearchProviderType;
  baseUrl: string;
  apiKey: string;
  cxId: string;
}

// ---------------------------------------------------------------------------
// Search Provider Metadata
// ---------------------------------------------------------------------------

const SEARCH_PROVIDER_INFO: Record<
  SearchProviderType,
  {
    label: string;
    needsUrl: boolean;
    needsApiKey: boolean;
    needsCxId: boolean;
    description: string;
    keyPlaceholder: string;
    urlPlaceholder: string;
  }
> = {
  duckduckgo: {
    label: "DuckDuckGo (via Colab)",
    needsUrl: true,
    needsApiKey: false,
    needsCxId: false,
    description:
      "Uses your Colab proxy URL for Jina AI + DDG search",
    keyPlaceholder: "",
    urlPlaceholder: "https://your-proxy.ngrok-free.app",
  },
  searxng: {
    label: "SearXNG",
    needsUrl: true,
    needsApiKey: false,
    needsCxId: false,
    description: "Self-hosted meta search engine",
    keyPlaceholder: "",
    urlPlaceholder: "https://your-searxng-instance.com",
  },
  brave: {
    label: "Brave Search",
    needsUrl: false,
    needsApiKey: true,
    needsCxId: false,
    description: "Brave Search API",
    keyPlaceholder: "BSA-xxxx...",
    urlPlaceholder: "",
  },
  serper: {
    label: "Serper.dev",
    needsUrl: false,
    needsApiKey: true,
    needsCxId: false,
    description: "Google SERP API",
    keyPlaceholder: "sk-...",
    urlPlaceholder: "",
  },
  tavily: {
    label: "Tavily",
    needsUrl: false,
    needsApiKey: true,
    needsCxId: false,
    description: "AI-optimized search API",
    keyPlaceholder: "tvly-...",
    urlPlaceholder: "",
  },
  google_cse: {
    label: "Google CSE",
    needsUrl: false,
    needsApiKey: true,
    needsCxId: true,
    description: "Google Custom Search Engine",
    keyPlaceholder: "AIza...",
    urlPlaceholder: "",
  },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const {
    providers,
    addProvider,
    updateProvider,
    removeProvider,
    setProviderModels,
    searchProviders,
    addSearchProvider,
    updateSearchProvider,
    removeSearchProvider,
    activeSearchProviderId,
    setActiveSearchProviderId,
    pageReaderUrl,
    setPageReaderUrl,
  } = useAppStore();

  // ---- AI Provider state ----
  const [form, setForm] = useState<AddProviderForm>({
    name: "",
    baseUrl: "",
    apiKey: "",
  });
  const [showForm, setShowForm] = useState(false);
  const [showApiKeys, setShowApiKeys] = useState<Record<string, boolean>>({});
  const [isLoadingModels, setIsLoadingModels] = useState<Record<string, boolean>>({});
  const [isAddingProvider, setIsAddingProvider] = useState(false);
  const [discoveredModels, setDiscoveredModels] = useState<ModelInfo[]>([]);
  const [expandedModels, setExpandedModels] = useState<Record<string, boolean>>({});

  // ---- Search Provider state ----
  const [searchForm, setSearchForm] = useState<AddSearchProviderForm>({
    name: "",
    type: "duckduckgo",
    baseUrl: "",
    apiKey: "",
    cxId: "",
  });
  const [showSearchForm, setShowSearchForm] = useState(false);
  const [showSearchApiKeys, setShowSearchApiKeys] = useState<Record<string, boolean>>({});
  const [isTestingSearch, setIsTestingSearch] = useState(false);
  const [testSearchResults, setTestSearchResults] = useState<
    { title: string; url: string; snippet: string; content?: string }[]
  >([]);

  // ---- Active tab ----
  const [activeTab, setActiveTab] = useState("providers");

  // ---- Helpers ----

  const resetForm = () => {
    setForm({ name: "", baseUrl: "", apiKey: "" });
    setDiscoveredModels([]);
    setShowForm(false);
  };

  const resetSearchForm = () => {
    setSearchForm({
      name: "",
      type: "duckduckgo",
      baseUrl: "",
      apiKey: "",
      cxId: "",
    });
    setShowSearchForm(false);
  };

  // ---- API: Fetch models via GET ----

  const fetchModels = useCallback(
    async (baseUrl: string, apiKey: string) => {
      const params = new URLSearchParams({ baseUrl });
      if (apiKey) params.set("apiKey", apiKey);

      const response = await fetch(`/api/models?${params.toString()}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to fetch models");
      }

      return data.data || [];
    },
    []
  );

  // ---- AI Provider handlers ----

  const handleDiscoverModels = async () => {
    if (!form.baseUrl.trim()) {
      toast.error("Please enter a base URL");
      return;
    }

    setIsAddingProvider(true);
    try {
      const models = await fetchModels(form.baseUrl.trim(), form.apiKey.trim());

      if (!models || models.length === 0) {
        toast.error("No models found at this endpoint. Check your URL and API key.");
        return;
      }

      setDiscoveredModels(models);

      // Auto-set provider name from URL if empty
      if (!form.name) {
        try {
          const url = new URL(form.baseUrl.trim());
          setForm((prev) => ({
            ...prev,
            name: url.hostname.replace("api.", "").split(".")[0],
          }));
        } catch {
          // keep empty
        }
      }

      toast.success(`Discovered ${models.length} model${models.length > 1 ? "s" : ""}`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not fetch models"
      );
    } finally {
      setIsAddingProvider(false);
    }
  };

  const handleAddProvider = () => {
    if (!form.name.trim() || !form.baseUrl.trim() || !form.apiKey.trim()) {
      toast.error("Please fill in all fields");
      return;
    }

    const id = storage.generateId();

    const provider = {
      id,
      name: form.name.trim(),
      baseUrl: form.baseUrl.trim(),
      apiKey: form.apiKey.trim(),
      models: discoveredModels.map((m) => ({ ...m, providerId: id })),
      addedAt: Date.now(),
      isEnabled: true,
    };

    addProvider(provider);
    resetForm();
    toast.success(`${provider.name} added with ${provider.models.length} model${provider.models.length !== 1 ? "s" : ""}`);
  };

  const handleRefreshModels = async (providerId: string) => {
    const provider = providers.find((p) => p.id === providerId);
    if (!provider) return;

    setIsLoadingModels((prev) => ({ ...prev, [providerId]: true }));
    try {
      const models = await fetchModels(provider.baseUrl, provider.apiKey);
      const mappedModels = (models || []).map((m: ModelInfo) => ({
        ...m,
        providerId,
      }));
      setProviderModels(providerId, mappedModels);
      toast.success(
        `Refreshed ${mappedModels.length} model${mappedModels.length !== 1 ? "s" : ""} for ${provider.name}`
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not refresh models"
      );
    } finally {
      setIsLoadingModels((prev) => ({ ...prev, [providerId]: false }));
    }
  };

  const handleRemoveProvider = (id: string, name: string) => {
    removeProvider(id);
    toast.success(`"${name}" removed`);
  };

  // ---- Search Provider handlers ----

  const handleAddSearchProvider = () => {
    const info = SEARCH_PROVIDER_INFO[searchForm.type];

    if (!searchForm.name.trim()) {
      toast.error("Please enter a name");
      return;
    }
    if (info.needsUrl && !searchForm.baseUrl.trim()) {
      toast.error("This provider requires a base URL");
      return;
    }
    if (info.needsApiKey && !searchForm.apiKey.trim()) {
      toast.error("This provider requires an API key");
      return;
    }
    if (info.needsCxId && !searchForm.cxId.trim()) {
      toast.error("Google CSE requires a CX ID");
      return;
    }

    const provider = {
      id: storage.generateId(),
      name: searchForm.name.trim(),
      type: searchForm.type,
      baseUrl: searchForm.baseUrl.trim() || undefined,
      apiKey: searchForm.apiKey.trim() || undefined,
      cxId: searchForm.cxId.trim() || undefined,
      isEnabled: true,
      addedAt: Date.now(),
    };

    addSearchProvider(provider);
    setActiveSearchProviderId(provider.id);
    resetSearchForm();
    toast.success(`${provider.name} (${SEARCH_PROVIDER_INFO[provider.type].label}) added`);
  };

  const handleRemoveSearchProvider = (id: string, name: string) => {
    removeSearchProvider(id);
    if (activeSearchProviderId === id) {
      setActiveSearchProviderId(null);
    }
    toast.success(`"${name}" removed`);
  };

  const handleTestSearch = async () => {
    const activeProv = searchProviders.find(
      (p) => p.id === activeSearchProviderId && p.isEnabled
    );
    if (!activeProv) {
      toast.error("Set an active search provider first");
      return;
    }

    setIsTestingSearch(true);
    setTestSearchResults([]);
    try {
      const params = new URLSearchParams({
        q: "NebChat AI test search",
        type: activeProv.type,
      });
      if (activeProv.baseUrl) params.set("url", activeProv.baseUrl);
      if (activeProv.apiKey) params.set("apiKey", activeProv.apiKey);
      if (activeProv.cxId) params.set("cxId", activeProv.cxId);

      const response = await fetch(`/api/search?${params.toString()}`);
      const data = await response.json();

      if (!response.ok) throw new Error(data.error || "Search failed");

      const results = data.results || [];
      setTestSearchResults(results);

      if (results.length > 0) {
        toast.success(`Search works! Found ${results.length} result${results.length > 1 ? "s" : ""}`);
      } else {
        toast.warning("Search returned no results. Check your provider config.");
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Search test failed"
      );
    } finally {
      setIsTestingSearch(false);
    }
  };

  // ---- Render ----

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl w-full h-dvh sm:h-[85vh] flex flex-col overflow-hidden p-0 gap-0 max-w-full">
        {/* Header */}
        <DialogHeader className="shrink-0 p-3 sm:p-6 sm:pb-4 pb-2">
          <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
            <Settings className="h-4 w-4 sm:h-5 sm:w-5" />
            Settings
          </DialogTitle>
          <DialogDescription className="text-xs sm:text-sm">
            Manage your AI providers, search engines, and preferences. All data
            stays in your browser.
          </DialogDescription>
        </DialogHeader>

        {/* Tabs */}
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="flex-1 flex flex-col min-h-0 overflow-hidden"
        >
          <div className="shrink-0 px-3 sm:px-6">
            <TabsList className="w-full h-auto flex-wrap">
              <TabsTrigger value="providers" className="flex-1 gap-1 text-xs sm:text-sm">
                <Server className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">AI </span>Providers
              </TabsTrigger>
              <TabsTrigger value="search" className="flex-1 gap-1 text-xs sm:text-sm">
                <Search className="h-3.5 w-3.5" />
                Search
              </TabsTrigger>
              <TabsTrigger value="swarm" className="flex-1 gap-1 text-xs sm:text-sm">
                <Zap className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Agentic </span>Swarm
              </TabsTrigger>
            </TabsList>
          </div>

          {/* ============================================================ */}
          {/* AI PROVIDERS TAB                                             */}
          {/* ============================================================ */}
          <TabsContent
            value="providers"
            className="flex-1 min-h-0 mt-0 overflow-hidden"
          >
            <ScrollArea className="h-full">
              <div className="px-3 sm:px-6 pb-6 space-y-4 sm:space-y-6">
                {/* Section header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold">API Providers</h3>
                    <p className="text-xs text-muted-foreground">
                      Add OpenAI-compatible API endpoints
                    </p>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => setShowForm(!showForm)}
                    className="gap-1.5 w-full sm:w-auto"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add Provider
                  </Button>
                </div>

                {/* ---------- Add Provider Form ---------- */}
                {showForm && (
                  <div className="rounded-lg border bg-card p-4 space-y-4">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Zap className="h-4 w-4 text-amber-500" />
                      Add New Provider
                    </div>

                    <div className="grid gap-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="provider-name" className="text-xs">
                          Provider Name
                        </Label>
                        <Input
                          id="provider-name"
                          placeholder="e.g. OpenAI, Groq, Together"
                          value={form.name}
                          onChange={(e) =>
                            setForm((prev) => ({
                              ...prev,
                              name: e.target.value,
                            }))
                          }
                          className="h-9 text-sm"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor="base-url" className="text-xs">
                          Base URL
                        </Label>
                        <Input
                          id="base-url"
                          placeholder="https://api.openai.com"
                          value={form.baseUrl}
                          onChange={(e) =>
                            setForm((prev) => ({
                              ...prev,
                              baseUrl: e.target.value,
                            }))
                          }
                          className="h-9 text-sm"
                        />
                        <p className="text-[10px] text-muted-foreground">
                          The API base URL (without /v1/ path)
                        </p>
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor="api-key" className="text-xs">
                          API Key
                        </Label>
                        <Input
                          id="api-key"
                          type="password"
                          placeholder="sk-..."
                          value={form.apiKey}
                          onChange={(e) =>
                            setForm((prev) => ({
                              ...prev,
                              apiKey: e.target.value,
                            }))
                          }
                          className="h-9 text-sm"
                        />
                        <p className="text-[10px] text-muted-foreground">
                          Your API key stays in your browser and is never sent to
                          our servers
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleDiscoverModels}
                        disabled={isAddingProvider || !form.baseUrl.trim()}
                        className="gap-1.5"
                      >
                        {isAddingProvider ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Globe className="h-3.5 w-3.5" />
                        )}
                        Discover Models
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={resetForm}
                      >
                        Cancel
                      </Button>
                    </div>

                    {/* Discovered Models Preview */}
                    {discoveredModels.length > 0 && (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                          <Check className="h-3.5 w-3.5" />
                          {discoveredModels.length} model
                          {discoveredModels.length !== 1 ? "s" : ""} discovered
                        </div>
                        <div className="max-h-32 overflow-y-auto rounded-md border bg-background p-2">
                          <div className="flex flex-wrap gap-1.5">
                            {discoveredModels.map((model) => (
                              <Badge
                                key={model.id}
                                variant="secondary"
                                className="text-[10px] font-normal"
                              >
                                {model.name || model.id}
                              </Badge>
                            ))}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          onClick={handleAddProvider}
                          className="gap-1.5 w-full"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Add Provider with {discoveredModels.length} Model
                          {discoveredModels.length !== 1 ? "s" : ""}
                        </Button>
                      </div>
                    )}
                  </div>
                )}

                {/* ---------- Existing Providers ---------- */}
                {providers.length === 0 && !showForm ? (
                  <div className="rounded-lg border border-dashed p-8 text-center">
                    <Server className="h-10 w-10 mx-auto text-muted-foreground/30 mb-3" />
                    <p className="text-sm font-medium text-muted-foreground">
                      No providers configured
                    </p>
                    <p className="text-xs text-muted-foreground/60 mt-1">
                      Add an OpenAI-compatible API provider to get started
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {providers.map((provider) => {
                      const isExpanded = expandedModels[provider.id];
                      return (
                        <div
                          key={provider.id}
                          className="rounded-lg border bg-card p-4 space-y-3"
                        >
                          {/* Row 1: icon + name + badge + switch */}
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-primary/10 text-primary shrink-0">
                                <Key className="h-4 w-4" />
                              </div>
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-medium text-sm">
                                    {provider.name}
                                  </span>
                                  {provider.isEnabled ? (
                                    <Badge
                                      variant="outline"
                                      className="text-[10px] px-1.5 py-0 h-4 border-emerald-500/30 text-emerald-600 dark:text-emerald-400 shrink-0"
                                    >
                                      Active
                                    </Badge>
                                  ) : (
                                    <Badge
                                      variant="outline"
                                      className="text-[10px] px-1.5 py-0 h-4 shrink-0"
                                    >
                                      Disabled
                                    </Badge>
                                  )}
                                </div>
                                {/* Masked API key */}
                                <div className="flex items-center gap-1.5 mt-0.5">
                                  <span className="text-[11px] text-muted-foreground font-mono truncate max-w-[180px] sm:max-w-[240px]">
                                    {showApiKeys[provider.id]
                                      ? provider.apiKey
                                      : storage.maskApiKey(provider.apiKey)}
                                  </span>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-5 w-5 shrink-0"
                                    onClick={() =>
                                      setShowApiKeys((prev) => ({
                                        ...prev,
                                        [provider.id]: !prev[provider.id],
                                      }))
                                    }
                                  >
                                    {showApiKeys[provider.id] ? (
                                      <EyeOff className="h-3 w-3" />
                                    ) : (
                                      <Eye className="h-3 w-3" />
                                    )}
                                  </Button>
                                </div>
                              </div>
                            </div>

                            <Switch
                              checked={provider.isEnabled}
                              onCheckedChange={(checked) =>
                                updateProvider(provider.id, {
                                  isEnabled: checked,
                                })
                              }
                              className="shrink-0"
                            />
                          </div>

                          {/* Row 2: Base URL */}
                          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                            <Globe className="h-3 w-3 shrink-0" />
                            <span className="font-mono truncate">
                              {provider.baseUrl}
                            </span>
                          </div>

                          {/* Row 3: Models info + actions */}
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <Badge
                                variant="secondary"
                                className="text-[10px] shrink-0"
                              >
                                {provider.models.length} model
                                {provider.models.length !== 1 ? "s" : ""}
                              </Badge>
                              {provider.models.length > 0 && !isExpanded && (
                                <span className="text-[10px] text-muted-foreground truncate">
                                  {provider.models
                                    .slice(0, 3)
                                    .map((m) => m.name || m.id)
                                    .join(", ")}
                                  {provider.models.length > 3 &&
                                    ` +${provider.models.length - 3} more`}
                                </span>
                              )}
                              {provider.models.length > 3 && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-5 px-1 text-[10px] text-muted-foreground"
                                  onClick={() =>
                                    setExpandedModels((prev) => ({
                                      ...prev,
                                      [provider.id]: !prev[provider.id],
                                    }))
                                  }
                                >
                                  {isExpanded ? (
                                    <ChevronUp className="h-3 w-3" />
                                  ) : (
                                    <ChevronDown className="h-3 w-3" />
                                  )}
                                </Button>
                              )}
                            </div>

                            <div className="flex items-center gap-1 shrink-0">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() =>
                                  handleRefreshModels(provider.id)
                                }
                                disabled={isLoadingModels[provider.id]}
                                title="Refresh models"
                              >
                                {isLoadingModels[provider.id] ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <RefreshCw className="h-3.5 w-3.5" />
                                )}
                              </Button>
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 text-destructive hover:text-destructive"
                                    title="Remove provider"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>
                                      Remove Provider
                                    </AlertDialogTitle>
                                    <AlertDialogDescription>
                                      Are you sure you want to remove{" "}
                                      <strong>{provider.name}</strong>? This will
                                      also delete all conversations using this
                                      provider.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction
                                      onClick={() =>
                                        handleRemoveProvider(
                                          provider.id,
                                          provider.name
                                        )
                                      }
                                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                    >
                                      Remove
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </div>
                          </div>

                          {/* Expanded model list */}
                          {isExpanded && provider.models.length > 0 && (
                            <div className="max-h-40 overflow-y-auto rounded-md border bg-background p-2">
                              <div className="flex flex-wrap gap-1.5">
                                {provider.models.map((m) => (
                                  <Badge
                                    key={m.id}
                                    variant="secondary"
                                    className="text-[10px] font-normal"
                                  >
                                    {m.name || m.id}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                <Separator />

                {/* Privacy Notice */}
                <div className="rounded-lg bg-muted/50 p-4">
                  <h4 className="text-xs font-semibold flex items-center gap-2 mb-2">
                    <Shield className="h-3.5 w-3.5" />
                    Privacy &amp; Security
                  </h4>
                  <ul className="text-[11px] text-muted-foreground space-y-1">
                    <li>All data is stored locally in your browser cache</li>
                    <li>API keys never leave your device unencrypted</li>
                    <li>Chat messages are only sent to your chosen AI provider</li>
                    <li>No data is sent to any third-party servers</li>
                  </ul>
                </div>
              </div>
            </ScrollArea>
          </TabsContent>

          {/* ============================================================ */}
          {/* SEARCH TAB                                                   */}
          {/* ============================================================ */}
          <TabsContent
            value="search"
            className="flex-1 min-h-0 mt-0 overflow-hidden"
          >
            <ScrollArea className="h-full">
              <div className="px-3 sm:px-6 pb-6 space-y-4 sm:space-y-6">
                {/* Section header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold">Search Providers</h3>
                    <p className="text-xs text-muted-foreground">
                      Add a search engine for AI-powered web search
                    </p>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => setShowSearchForm(!showSearchForm)}
                    className="gap-1.5 w-full sm:w-auto"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add Search
                  </Button>
                </div>

                {/* ---------- Active Provider Indicator ---------- */}
                {activeSearchProviderId && (() => {
                  const activeProv = searchProviders.find(
                    (p) => p.id === activeSearchProviderId
                  );
                  return activeProv ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200/50 dark:border-emerald-800/30">
                        <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                        <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
                          Active: {activeProv.name}
                        </span>
                        <Badge
                          variant="outline"
                          className="text-[10px] px-1.5 py-0 h-4 border-emerald-400/40 text-emerald-600 dark:text-emerald-400 ml-auto"
                        >
                          {SEARCH_PROVIDER_INFO[activeProv.type].label}
                        </Badge>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleTestSearch}
                        disabled={isTestingSearch}
                        className="gap-1.5"
                      >
                        {isTestingSearch ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Search className="h-3.5 w-3.5" />
                        )}
                        Test Search
                      </Button>
                      {testSearchResults.length > 0 && (
                        <div className="rounded-lg border border-emerald-200/50 dark:border-emerald-800/30 bg-emerald-50/30 dark:bg-emerald-950/10 p-3 space-y-2">
                          <div className="text-xs font-medium text-emerald-700 dark:text-emerald-300 flex items-center gap-1">
                            <Check className="h-3 w-3" /> Search working &mdash;{" "}
                            {testSearchResults.length} result
                            {testSearchResults.length !== 1 ? "s" : ""}
                          </div>
                          {testSearchResults.map((r, i) => (
                            <div key={i} className="text-[10px] space-y-0.5">
                              <div className="font-medium text-foreground truncate">
                                {r.title}
                              </div>
                              <div className="text-muted-foreground line-clamp-1">
                                {r.snippet}
                              </div>
                              <a
                                href={r.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-600 dark:text-blue-400 hover:underline truncate block"
                              >
                                {r.url}
                              </a>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : null;
                })()}

                {/* ---------- Add Search Provider Form ---------- */}
                {showSearchForm && (
                  <div className="rounded-lg border bg-card p-4 space-y-4">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Search className="h-4 w-4 text-emerald-500" />
                      Add Search Provider
                    </div>

                    <div className="grid gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs">Name</Label>
                        <Input
                          placeholder="e.g. My Search"
                          value={searchForm.name}
                          onChange={(e) =>
                            setSearchForm((prev) => ({
                              ...prev,
                              name: e.target.value,
                            }))
                          }
                          className="h-9 text-sm"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-xs">Provider Type</Label>
                        <Select
                          value={searchForm.type}
                          onValueChange={(value) =>
                            setSearchForm((prev) => ({
                              ...prev,
                              type: value as SearchProviderType,
                              baseUrl: "",
                              apiKey: "",
                              cxId: "",
                            }))
                          }
                        >
                          <SelectTrigger className="h-9 text-sm">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(SEARCH_PROVIDER_INFO).map(
                              ([key, info]) => (
                                <SelectItem key={key} value={key}>
                                  {info.label}
                                </SelectItem>
                              )
                            )}
                          </SelectContent>
                        </Select>
                        <p className="text-[10px] text-muted-foreground">
                          {SEARCH_PROVIDER_INFO[searchForm.type].description}
                        </p>
                      </div>

                      {SEARCH_PROVIDER_INFO[searchForm.type].needsUrl && (
                        <div className="space-y-1.5">
                          <Label className="text-xs">Base URL</Label>
                          <Input
                            placeholder={
                              SEARCH_PROVIDER_INFO[searchForm.type]
                                .urlPlaceholder
                            }
                            value={searchForm.baseUrl}
                            onChange={(e) =>
                              setSearchForm((prev) => ({
                                ...prev,
                                baseUrl: e.target.value,
                              }))
                            }
                            className="h-9 text-sm"
                          />
                        </div>
                      )}

                      {SEARCH_PROVIDER_INFO[searchForm.type].needsApiKey && (
                        <div className="space-y-1.5">
                          <Label className="text-xs">API Key</Label>
                          <Input
                            type="password"
                            placeholder={
                              SEARCH_PROVIDER_INFO[searchForm.type]
                                .keyPlaceholder
                            }
                            value={searchForm.apiKey}
                            onChange={(e) =>
                              setSearchForm((prev) => ({
                                ...prev,
                                apiKey: e.target.value,
                              }))
                            }
                            className="h-9 text-sm"
                          />
                        </div>
                      )}

                      {SEARCH_PROVIDER_INFO[searchForm.type].needsCxId && (
                        <div className="space-y-1.5">
                          <Label className="text-xs">
                            Custom Search Engine ID (CX)
                          </Label>
                          <Input
                            placeholder="e.g. 017576662..."
                            value={searchForm.cxId}
                            onChange={(e) =>
                              setSearchForm((prev) => ({
                                ...prev,
                                cxId: e.target.value,
                              }))
                            }
                            className="h-9 text-sm"
                          />
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        onClick={handleAddSearchProvider}
                        className="gap-1.5"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Add Search Provider
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={resetSearchForm}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}

                {/* ---------- Existing Search Providers ---------- */}
                {searchProviders.length === 0 && !showSearchForm ? (
                  <div className="rounded-lg border border-dashed p-8 text-center">
                    <Search className="h-10 w-10 mx-auto text-muted-foreground/30 mb-3" />
                    <p className="text-sm font-medium text-muted-foreground">
                      No search providers configured
                    </p>
                    <p className="text-xs text-muted-foreground/60 mt-1">
                      Add a search engine to enable AI-powered web search
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {searchProviders.map((provider) => (
                      <div
                        key={provider.id}
                        className={`rounded-lg border bg-card p-4 space-y-3 transition-all ${
                          activeSearchProviderId === provider.id
                            ? "border-emerald-500/50 ring-1 ring-emerald-500/20"
                            : ""
                        }`}
                      >
                        {/* Row 1: icon + name + badges + actions */}
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <div
                              className={`flex items-center justify-center h-9 w-9 rounded-lg shrink-0 ${
                                activeSearchProviderId === provider.id
                                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                  : "bg-primary/10 text-primary"
                              }`}
                            >
                              <Search className="h-4 w-4" />
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-medium text-sm">
                                  {provider.name}
                                </span>
                                <Badge
                                  variant="outline"
                                  className="text-[10px] px-1.5 py-0 h-4 shrink-0"
                                >
                                  {SEARCH_PROVIDER_INFO[provider.type].label}
                                </Badge>
                                {activeSearchProviderId === provider.id && (
                                  <Badge className="text-[10px] px-1.5 py-0 h-4 bg-emerald-500 text-white shrink-0">
                                    Active
                                  </Badge>
                                )}
                              </div>
                              {provider.baseUrl && (
                                <span className="text-[11px] text-muted-foreground font-mono truncate block max-w-[220px] mt-0.5">
                                  {provider.baseUrl}
                                </span>
                              )}
                              {provider.apiKey && (
                                <div className="flex items-center gap-1.5 mt-0.5">
                                  <span className="text-[11px] text-muted-foreground font-mono">
                                    {showSearchApiKeys[provider.id]
                                      ? provider.apiKey
                                      : storage.maskApiKey(provider.apiKey)}
                                  </span>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-5 w-5 shrink-0"
                                    onClick={() =>
                                      setShowSearchApiKeys((prev) => ({
                                        ...prev,
                                        [provider.id]: !prev[provider.id],
                                      }))
                                    }
                                  >
                                    {showSearchApiKeys[provider.id] ? (
                                      <EyeOff className="h-3 w-3" />
                                    ) : (
                                      <Eye className="h-3 w-3" />
                                    )}
                                  </Button>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Set Active / Enable / Delete */}
                          <div className="flex items-center gap-2 shrink-0">
                            <Button
                              variant={
                                activeSearchProviderId === provider.id
                                  ? "default"
                                  : "outline"
                              }
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() =>
                                setActiveSearchProviderId(
                                  activeSearchProviderId === provider.id
                                    ? null
                                    : provider.id
                                )
                              }
                            >
                              {activeSearchProviderId === provider.id
                                ? "Active"
                                : "Set Active"}
                            </Button>
                            <Switch
                              checked={provider.isEnabled}
                              onCheckedChange={(checked) =>
                                updateSearchProvider(provider.id, {
                                  isEnabled: checked,
                                })
                              }
                            />
                          </div>
                        </div>

                        {/* Delete row */}
                        <div className="flex items-center justify-end">
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-destructive hover:text-destructive"
                                title="Remove search provider"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>
                                  Remove Search Provider
                                </AlertDialogTitle>
                                <AlertDialogDescription>
                                  Are you sure you want to remove{" "}
                                  <strong>{provider.name}</strong>?
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() =>
                                    handleRemoveSearchProvider(
                                      provider.id,
                                      provider.name
                                    )
                                  }
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                  Remove
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* ---------- Search Provider Comparison ---------- */}
                <div className="rounded-lg bg-muted/50 p-4">
                  <h4 className="text-xs font-semibold flex items-center gap-2 mb-3">
                    <Globe className="h-3.5 w-3.5" />
                    Available Search Providers
                  </h4>
                  <div className="space-y-2">
                    {Object.entries(SEARCH_PROVIDER_INFO).map(
                      ([key, info]) => (
                        <div
                          key={key}
                          className="flex items-start gap-2 text-[11px]"
                        >
                          <Badge
                            variant="outline"
                            className="text-[10px] px-1.5 py-0 h-4 shrink-0 mt-0.5"
                          >
                            {info.label}
                          </Badge>
                          <span className="text-muted-foreground">
                            {info.description}
                          </span>
                        </div>
                      )
                    )}
                  </div>
                </div>

                <Separator />

                {/* ---------- Page Reader ---------- */}
                <div className="space-y-3">
                  <div>
                    <h3 className="text-sm font-semibold flex items-center gap-2">
                      <BookOpen className="h-4 w-4" />
                      Page Reader
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      Reads full web page content from search results for richer
                      AI context
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">
                      Crawl4AI / Jina Reader URL (optional)
                    </Label>
                    <Input
                      placeholder="https://your-proxy.ngrok-free.app"
                      value={pageReaderUrl || ""}
                      onChange={(e) => {
                        const url = e.target.value.trim() || null;
                        setPageReaderUrl(url);
                      }}
                      className="h-9 text-sm"
                    />
                    <p className="text-[10px] text-muted-foreground">
                      Self-hosted Crawl4AI server or unified proxy URL. If using
                      the Colab unified proxy, use the same URL as your provider
                      base URL. Falls back to Jina Reader if not configured.
                    </p>
                  </div>
                  {pageReaderUrl ? (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200/50 dark:border-blue-800/30">
                      <div className="h-2 w-2 rounded-full bg-blue-500" />
                      <span className="text-xs font-medium text-blue-700 dark:text-blue-300">
                        Crawl4AI active &mdash; pages read via your server
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-800/30">
                      <div className="h-2 w-2 rounded-full bg-amber-500" />
                      <span className="text-xs text-amber-700 dark:text-amber-300">
                        Using Jina Reader (free fallback) &mdash; add Crawl4AI
                        for self-hosted page reading
                      </span>
                    </div>
                  )}

                  {/* Unified Proxy Tip */}
                  <div className="rounded-lg bg-violet-50 dark:bg-violet-950/20 border border-violet-200/50 dark:border-violet-800/30 p-3">
                    <h4 className="text-[11px] font-semibold text-violet-700 dark:text-violet-300 flex items-center gap-1.5 mb-1.5">
                      <Zap className="h-3 w-3" /> Colab Unified Proxy Tip
                    </h4>
                    <p className="text-[10px] text-violet-600/80 dark:text-violet-400/80 leading-relaxed">
                      If you&apos;re using the Colab setup script, all services
                      (Ollama, DuckDuckGo Search, Crawl4AI) run through a single
                      proxy. Use the <strong>same base URL</strong> for:
                    </p>
                    <ul className="text-[10px] text-violet-600/80 dark:text-violet-400/80 mt-1 space-y-0.5">
                      <li>AI Provider Base URL</li>
                      <li>Search Provider Base URL (DuckDuckGo or SearXNG)</li>
                      <li>Page Reader URL (this field)</li>
                    </ul>
                  </div>
                </div>
              </div>
            </ScrollArea>
          </TabsContent>
          {/* ============================================================ */}
          {/* SWARM TAB                                                    */}
          {/* ============================================================ */}
          <TabsContent value="swarm" className="flex-1 min-h-0 mt-0 overflow-hidden">
            <ScrollArea className="h-full">
              <div className="px-3 sm:px-6 pb-6 space-y-4 sm:space-y-6">
                {/* Section header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold">Agentic Swarm</h3>
                    <p className="text-xs text-muted-foreground">
                      Automated multi-agent research with user-in-the-loop control
                    </p>
                  </div>
                  <Badge
                    variant="outline"
                    className="text-[10px] px-2 py-0.5 h-5 border-violet-400/40 text-violet-600 dark:text-violet-400 self-start sm:self-auto"
                  >
                    <Zap className="h-3 w-3 mr-1" />
                    New
                  </Badge>
                </div>

                {/* ---------- How it Works ---------- */}
                <div className="rounded-lg bg-violet-50 dark:bg-violet-950/20 border border-violet-200/50 dark:border-violet-800/30 p-4 space-y-3">
                  <h4 className="text-xs font-semibold text-violet-700 dark:text-violet-300 flex items-center gap-1.5">
                    <Brain className="h-3.5 w-3.5" /> How it Works
                  </h4>
                  <p className="text-[11px] text-violet-600/80 dark:text-violet-400/80 leading-relaxed">
                    The Agentic Swarm is a team of AI agents that work together to
                    research, analyze, and synthesize information — while keeping
                    you in the loop every step of the way.
                  </p>
                  <ul className="space-y-2">
                    <li className="flex items-start gap-2 text-[11px] text-violet-700 dark:text-violet-300">
                      <Crown className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-500" />
                      <span>
                        <strong>Manager agent</strong> coordinates the team and talks
                        directly to you
                      </span>
                    </li>
                    <li className="flex items-start gap-2 text-[11px] text-violet-700 dark:text-violet-300">
                      <Search className="h-3.5 w-3.5 mt-0.5 shrink-0 text-blue-500" />
                      <span>
                        <strong>Research agents</strong> search the web and read pages
                        autonomously
                      </span>
                    </li>
                    <li className="flex items-start gap-2 text-[11px] text-violet-700 dark:text-violet-300">
                      <Users className="h-3.5 w-3.5 mt-0.5 shrink-0 text-emerald-500" />
                      <span>
                        The swarm <strong>pauses when it needs your input</strong>{" "}
                        (user-in-the-loop)
                      </span>
                    </li>
                    <li className="flex items-start gap-2 text-[11px] text-violet-700 dark:text-violet-300">
                      <Shield className="h-3.5 w-3.5 mt-0.5 shrink-0 text-red-400" />
                      <span>
                        You have <strong>full control</strong> to stop or restart at any
                        time
                      </span>
                    </li>
                  </ul>
                </div>

                {/* ---------- Quick Start ---------- */}
                <div className="space-y-3">
                  <h4 className="text-xs font-semibold flex items-center gap-1.5">
                    <Zap className="h-3.5 w-3.5 text-amber-500" /> Quick Start
                  </h4>
                  <div className="rounded-lg border bg-card p-4 space-y-2.5">
                    <ul className="space-y-2">
                      <li className="flex items-start gap-2 text-[11px] text-muted-foreground">
                        <span className="flex items-center justify-center h-4 w-4 rounded-full bg-emerald-100 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 text-[9px] font-bold shrink-0">
                          1
                        </span>
                        Open the sidebar and tap &quot;Agentic Swarm&quot; to start
                      </li>
                      <li className="flex items-start gap-2 text-[11px] text-muted-foreground">
                        <span className="flex items-center justify-center h-4 w-4 rounded-full bg-emerald-100 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 text-[9px] font-bold shrink-0">
                          2
                        </span>
                        Or create a swarm from the home screen
                      </li>
                      <li className="flex items-start gap-2 text-[11px] text-muted-foreground">
                        <span className="flex items-center justify-center h-4 w-4 rounded-full bg-emerald-100 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 text-[9px] font-bold shrink-0">
                          3
                        </span>
                        Configure your agents with roles, models, and tools
                      </li>
                      <li className="flex items-start gap-2 text-[11px] text-muted-foreground">
                        <span className="flex items-center justify-center h-4 w-4 rounded-full bg-emerald-100 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 text-[9px] font-bold shrink-0">
                          4
                        </span>
                        The Manager will chat with you to understand your needs
                      </li>
                      <li className="flex items-start gap-2 text-[11px] text-muted-foreground">
                        <span className="flex items-center justify-center h-4 w-4 rounded-full bg-emerald-100 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 text-[9px] font-bold shrink-0">
                          5
                        </span>
                        Watch the activity feed in real-time
                      </li>
                      <li className="flex items-start gap-2 text-[11px] text-muted-foreground">
                        <span className="flex items-center justify-center h-4 w-4 rounded-full bg-emerald-100 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 text-[9px] font-bold shrink-0">
                          6
                        </span>
                        Respond when the swarm asks for your input
                      </li>
                    </ul>
                  </div>
                </div>

                {/* ---------- Swarm Capabilities ---------- */}
                <div className="space-y-3">
                  <h4 className="text-xs font-semibold flex items-center gap-1.5">
                    <Bot className="h-3.5 w-3.5 text-blue-500" /> Swarm Capabilities
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {/* CHAT */}
                    <div className="flex items-center gap-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200/50 dark:border-emerald-800/30 p-2.5">
                      <Badge className="bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border-emerald-300/50 dark:border-emerald-700/50 text-[9px] px-1.5 py-0 h-4 font-mono hover:bg-emerald-100">
                        CHAT
                      </Badge>
                      <span className="text-[11px] text-emerald-700 dark:text-emerald-300">
                        User-in-the-loop — swarm pauses for your input
                      </span>
                    </div>
                    {/* SEARCH */}
                    <div className="flex items-center gap-2.5 rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200/50 dark:border-blue-800/30 p-2.5">
                      <Badge className="bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border-blue-300/50 dark:border-blue-700/50 text-[9px] px-1.5 py-0 h-4 font-mono hover:bg-blue-100">
                        SEARCH
                      </Badge>
                      <span className="text-[11px] text-blue-700 dark:text-blue-300">
                        Web search — agents search the web autonomously
                      </span>
                    </div>
                    {/* READ */}
                    <div className="flex items-center gap-2.5 rounded-lg bg-cyan-50 dark:bg-cyan-950/20 border border-cyan-200/50 dark:border-cyan-800/30 p-2.5">
                      <Badge className="bg-cyan-100 dark:bg-cyan-900/40 text-cyan-700 dark:text-cyan-300 border-cyan-300/50 dark:border-cyan-700/50 text-[9px] px-1.5 py-0 h-4 font-mono hover:bg-cyan-100">
                        READ
                      </Badge>
                      <span className="text-[11px] text-cyan-700 dark:text-cyan-300">
                        Page reading — agents read and extract content from URLs
                      </span>
                    </div>
                    {/* DELEGATE */}
                    <div className="flex items-center gap-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-800/30 p-2.5">
                      <Badge className="bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border-amber-300/50 dark:border-amber-700/50 text-[9px] px-1.5 py-0 h-4 font-mono hover:bg-amber-100">
                        DELEGATE
                      </Badge>
                      <span className="text-[11px] text-amber-700 dark:text-amber-300">
                        Task delegation — manager assigns tasks to team members
                      </span>
                    </div>
                    {/* SYNTHESIZE */}
                    <div className="flex items-center gap-2.5 rounded-lg bg-violet-50 dark:bg-violet-950/20 border border-violet-200/50 dark:border-violet-800/30 p-2.5">
                      <Badge className="bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 border-violet-300/50 dark:border-violet-700/50 text-[9px] px-1.5 py-0 h-4 font-mono hover:bg-violet-100">
                        SYNTHESIZE
                      </Badge>
                      <span className="text-[11px] text-violet-700 dark:text-violet-300">
                        Knowledge synthesis — findings are combined
                      </span>
                    </div>
                    {/* TODO */}
                    <div className="flex items-center gap-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/20 border border-rose-200/50 dark:border-rose-800/30 p-2.5">
                      <Badge className="bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 border-rose-300/50 dark:border-rose-700/50 text-[9px] px-1.5 py-0 h-4 font-mono hover:bg-rose-100">
                        TODO
                      </Badge>
                      <span className="text-[11px] text-rose-700 dark:text-rose-300">
                        Task tracking — progress is tracked with todo lists
                      </span>
                    </div>
                    {/* FINAL */}
                    <div className="flex items-center gap-2.5 rounded-lg bg-indigo-50 dark:bg-indigo-950/20 border border-indigo-200/50 dark:border-indigo-800/30 p-2.5 sm:col-span-2">
                      <Badge className="bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 border-indigo-300/50 dark:border-indigo-700/50 text-[9px] px-1.5 py-0 h-4 font-mono hover:bg-indigo-100">
                        FINAL
                      </Badge>
                      <span className="text-[11px] text-indigo-700 dark:text-indigo-300">
                        Final report — comprehensive answer delivered
                      </span>
                    </div>
                  </div>
                </div>

                <Separator />

                <p className="text-[10px] text-muted-foreground/60 text-center">
                  Agentic Swarm runs entirely in your browser session. No data is sent
                  to external services beyond your configured AI providers.
                </p>
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
