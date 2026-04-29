"use client";

import { useAppStore } from "@/lib/store";
import { maskApiKey, generateId } from "@/lib/storage";
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
} from "lucide-react";
import { useState, useCallback } from "react";
import { toast } from "@/hooks/use-toast";

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

const SEARCH_PROVIDER_INFO: Record<SearchProviderType, { label: string; needsUrl: boolean; needsKey: boolean; needsCxId: boolean; description: string; keyPlaceholder: string; urlPlaceholder: string }> = {
  duckduckgo: {
    label: "DuckDuckGo",
    needsUrl: true,
    needsKey: false,
    needsCxId: false,
    description: "Free, no API key or Docker needed! Uses your Colab proxy URL. Best for Colab setups.",
    keyPlaceholder: "",
    urlPlaceholder: "https://your-proxy.ngrok-free.app",
  },
  searxng: {
    label: "SearXNG",
    needsUrl: true,
    needsKey: false,
    needsCxId: false,
    description: "Self-hosted meta-search engine. Requires Docker. Not recommended for Colab.",
    keyPlaceholder: "",
    urlPlaceholder: "https://your-searxng-instance.com",
  },
  brave: {
    label: "Brave Search",
    needsUrl: false,
    needsKey: true,
    needsCxId: false,
    description: "Brave Search API. Free tier: 2000 queries/month.",
    keyPlaceholder: "BSA-xxxx...",
    urlPlaceholder: "",
  },
  serper: {
    label: "Serper.dev",
    needsUrl: false,
    needsKey: true,
    needsCxId: false,
    description: "Google SERP API. Free tier: 2500 queries/month.",
    keyPlaceholder: "sk-...",
    urlPlaceholder: "",
  },
  tavily: {
    label: "Tavily",
    needsUrl: false,
    needsKey: true,
    needsCxId: false,
    description: "AI-optimized search. Free tier: 1000 queries/month.",
    keyPlaceholder: "tvly-...",
    urlPlaceholder: "",
  },
  google_cse: {
    label: "Google CSE",
    needsUrl: false,
    needsKey: true,
    needsCxId: true,
    description: "Google Custom Search Engine. Free tier: 100 queries/day.",
    keyPlaceholder: "AIza...",
    urlPlaceholder: "",
  },
};

export function SettingsDialog() {
  const {
    settingsOpen,
    setSettingsOpen,
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

  // Search provider form
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
  const [testSearchResults, setTestSearchResults] = useState<{ title: string; url: string; snippet: string; content?: string }[]>([]);

  const resetForm = () => {
    setForm({ name: "", baseUrl: "", apiKey: "" });
    setDiscoveredModels([]);
    setShowForm(false);
  };

  const resetSearchForm = () => {
    setSearchForm({ name: "", type: "duckduckgo", baseUrl: "", apiKey: "", cxId: "" });
    setShowSearchForm(false);
  };

  const fetchModels = useCallback(async (baseUrl: string, apiKey: string) => {
    try {
      const response = await fetch("/api/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl, apiKey }),
      });

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || "Failed to fetch models");
      }

      return data.data || [];
    } catch (error) {
      throw error;
    }
  }, []);

  const handleDiscoverModels = async () => {
    if (!form.baseUrl) {
      toast({ title: "Error", description: "Please enter a base URL", variant: "destructive" });
      return;
    }

    setIsAddingProvider(true);
    try {
      const models = await fetchModels(form.baseUrl, form.apiKey);
      
      if (!models || models.length === 0) {
        toast({
          title: "No Models Found",
          description: "Could not find any models at this endpoint. Check your URL and API key.",
          variant: "destructive",
        });
        setIsAddingProvider(false);
        return;
      }

      setDiscoveredModels(models);
      
      // Auto-set provider name from URL if empty
      if (!form.name) {
        try {
          const url = new URL(form.baseUrl);
          setForm((prev) => ({ ...prev, name: url.hostname.replace("api.", "").split(".")[0] }));
        } catch {
          // Keep empty name
        }
      }

      toast({
        title: "Models Discovered",
        description: `Found ${models.length} model${models.length > 1 ? "s" : ""}`,
      });
    } catch (error) {
      toast({
        title: "Discovery Failed",
        description: error instanceof Error ? error.message : "Could not fetch models",
        variant: "destructive",
      });
    } finally {
      setIsAddingProvider(false);
    }
  };

  const handleAddProvider = () => {
    if (!form.name || !form.baseUrl || !form.apiKey) {
      toast({ title: "Error", description: "Please fill all fields", variant: "destructive" });
      return;
    }

    const provider = {
      id: generateId(),
      name: form.name,
      baseUrl: form.baseUrl,
      apiKey: form.apiKey,
      models: discoveredModels.map((m) => ({
        ...m,
        providerId: "",
      })),
      addedAt: Date.now(),
      isEnabled: true,
    };

    // Set providerId on models
    provider.models = provider.models.map((m) => ({ ...m, providerId: provider.id }));

    addProvider(provider);
    resetForm();
    toast({
      title: "Provider Added",
      description: `${form.name} with ${provider.models.length} models`,
    });
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
      toast({
        title: "Models Refreshed",
        description: `Found ${mappedModels.length} models for ${provider.name}`,
      });
    } catch (error) {
      toast({
        title: "Refresh Failed",
        description: error instanceof Error ? error.message : "Could not refresh models",
        variant: "destructive",
      });
    } finally {
      setIsLoadingModels((prev) => ({ ...prev, [providerId]: false }));
    }
  };

  const handleRemoveProvider = (id: string) => {
    removeProvider(id);
    toast({ title: "Provider Removed" });
  };

  // Search provider handlers
  const handleAddSearchProvider = () => {
    const info = SEARCH_PROVIDER_INFO[searchForm.type];
    if (!searchForm.name) {
      toast({ title: "Error", description: "Please enter a name", variant: "destructive" });
      return;
    }
    if (info.needsUrl && !searchForm.baseUrl) {
      toast({ title: "Error", description: "This provider requires a base URL", variant: "destructive" });
      return;
    }
    if (info.needsKey && !searchForm.apiKey) {
      toast({ title: "Error", description: "This provider requires an API key", variant: "destructive" });
      return;
    }
    if (info.needsCxId && !searchForm.cxId) {
      toast({ title: "Error", description: "Google CSE requires a CX ID", variant: "destructive" });
      return;
    }

    const provider = {
      id: generateId(),
      name: searchForm.name,
      type: searchForm.type,
      baseUrl: searchForm.baseUrl || undefined,
      apiKey: searchForm.apiKey || undefined,
      cxId: searchForm.cxId || undefined,
      isEnabled: true,
      addedAt: Date.now(),
    };

    addSearchProvider(provider);
    setActiveSearchProviderId(provider.id);
    resetSearchForm();
    toast({
      title: "Search Provider Added",
      description: `${provider.name} (${SEARCH_PROVIDER_INFO[provider.type].label})`,
    });
  };

  const handleRemoveSearchProvider = (id: string) => {
    removeSearchProvider(id);
    if (activeSearchProviderId === id) {
      setActiveSearchProviderId(null);
    }
    toast({ title: "Search Provider Removed" });
  };

  const handleTestSearch = async () => {
    const activeSearchProv = searchProviders.find((p) => p.id === activeSearchProviderId && p.isEnabled);
    if (!activeSearchProv) {
      toast({ title: "No Active Search Provider", description: "Set an active search provider first", variant: "destructive" });
      return;
    }
    setIsTestingSearch(true);
    setTestSearchResults([]);
    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: "NebChat AI test search",
          provider: {
            type: activeSearchProv.type,
            baseUrl: activeSearchProv.baseUrl,
            apiKey: activeSearchProv.apiKey,
            cxId: activeSearchProv.cxId,
          },
          maxResults: 3,
          fetchContent: false,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Search failed");
      setTestSearchResults(data.results || []);
      if ((data.results || []).length > 0) {
        toast({ title: "Search Works!", description: `Found ${(data.results || []).length} results`, variant: "default" });
      } else {
        toast({ title: "Search Returned Empty", description: "No results found. Check your provider config.", variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Search Test Failed", description: error instanceof Error ? error.message : "Unknown error", variant: "destructive" });
    } finally {
      setIsTestingSearch(false);
    }
  };

  return (
    <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
      <DialogContent className="max-w-2xl sm:max-w-2xl h-[85vh] flex flex-col overflow-hidden p-0 gap-0">
        <DialogHeader className="shrink-0 p-6 pb-4">
          <DialogTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Settings
          </DialogTitle>
          <DialogDescription>
            Manage your API providers, search engines, and preferences. All data stays in your browser.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="providers" className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <div className="shrink-0 px-6">
            <TabsList className="w-full">
              <TabsTrigger value="providers" className="flex-1 gap-1.5">
                <Server className="h-3.5 w-3.5" />
                AI Providers
              </TabsTrigger>
              <TabsTrigger value="search" className="flex-1 gap-1.5">
                <Search className="h-3.5 w-3.5" />
                Search
              </TabsTrigger>
            </TabsList>
          </div>

          {/* AI Providers Tab */}
          <TabsContent value="providers" className="flex-1 min-h-0 mt-0 overflow-hidden">
            <ScrollArea className="h-full">
              <div className="px-6 pb-6 space-y-6">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-semibold">API Providers</h3>
                      <p className="text-xs text-muted-foreground">
                        Add OpenAI-compatible API endpoints
                      </p>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => setShowForm(!showForm)}
                      className="gap-1.5"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add Provider
                    </Button>
                  </div>

                  {/* Add Provider Form */}
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
                              setForm((prev) => ({ ...prev, name: e.target.value }))
                            }
                            className="h-9 text-sm"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="base-url" className="text-xs">
                            Base URL
                          </Label>
                          <div className="flex gap-2">
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
                              className="h-9 text-sm flex-1"
                            />
                          </div>
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
                            Your API key stays in your browser and is never sent to our servers
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleDiscoverModels}
                          disabled={isAddingProvider || !form.baseUrl}
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
                            {discoveredModels.length} models discovered
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
                            Add Provider with {discoveredModels.length} Models
                          </Button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Existing Providers */}
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
                      {providers.map((provider) => (
                        <div
                          key={provider.id}
                          className="rounded-lg border bg-card p-4 space-y-3"
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex items-center gap-3">
                              <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-primary/10 text-primary shrink-0">
                                <Key className="h-4 w-4" />
                              </div>
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="font-medium text-sm">
                                    {provider.name}
                                  </span>
                                  {provider.isEnabled ? (
                                    <Badge
                                      variant="outline"
                                      className="text-[10px] px-1.5 py-0 h-4 border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
                                    >
                                      Active
                                    </Badge>
                                  ) : (
                                    <Badge
                                      variant="outline"
                                      className="text-[10px] px-1.5 py-0 h-4"
                                    >
                                      Disabled
                                    </Badge>
                                  )}
                                </div>
                                <div className="flex items-center gap-2 mt-0.5">
                                  <span className="text-[11px] text-muted-foreground font-mono truncate max-w-[200px]">
                                    {showApiKeys[provider.id]
                                      ? provider.apiKey
                                      : maskApiKey(provider.apiKey)}
                                  </span>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-5 w-5"
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
                            <div className="flex items-center gap-2">
                              <Switch
                                checked={provider.isEnabled}
                                onCheckedChange={(checked) =>
                                  updateProvider(provider.id, {
                                    isEnabled: checked,
                                  })
                                }
                              />
                            </div>
                          </div>

                          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                            <Globe className="h-3 w-3" />
                            <span className="font-mono truncate">
                              {provider.baseUrl}
                            </span>
                          </div>

                          {/* Models count and actions */}
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5">
                              <Badge variant="secondary" className="text-[10px]">
                                {provider.models.length} model
                                {provider.models.length !== 1 ? "s" : ""}
                              </Badge>
                              {provider.models.length > 0 && (
                                <div className="max-w-[250px] truncate text-[10px] text-muted-foreground">
                                  {provider.models
                                    .slice(0, 3)
                                    .map((m) => m.name || m.id)
                                    .join(", ")}
                                  {provider.models.length > 3 &&
                                    ` +${provider.models.length - 3} more`}
                                </div>
                              )}
                            </div>
                            <div className="flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => handleRefreshModels(provider.id)}
                                disabled={isLoadingModels[provider.id]}
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
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Remove Provider</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      Are you sure you want to remove {provider.name}? This will also
                                      delete all conversations using this provider.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction
                                      onClick={() => handleRemoveProvider(provider.id)}
                                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                    >
                                      Remove
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <Separator />

                {/* Privacy Notice */}
                <div className="rounded-lg bg-muted/50 p-4">
                  <h4 className="text-xs font-semibold flex items-center gap-2 mb-2">
                    🔒 Privacy & Security
                  </h4>
                  <ul className="text-[11px] text-muted-foreground space-y-1">
                    <li>• All data is stored locally in your browser cache</li>
                    <li>• API keys never leave your device unencrypted</li>
                    <li>• Chat messages are only sent to your chosen AI provider</li>
                    <li>• No data is sent to any third-party servers</li>
                  </ul>
                </div>
              </div>
            </ScrollArea>
          </TabsContent>

          {/* Search Tab */}
          <TabsContent value="search" className="flex-1 min-h-0 mt-0 overflow-hidden">
            <ScrollArea className="h-full">
              <div className="px-6 pb-6 space-y-6">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-semibold">Search Providers</h3>
                      <p className="text-xs text-muted-foreground">
                        Add a search engine for AI-powered web search
                      </p>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => setShowSearchForm(!showSearchForm)}
                      className="gap-1.5"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add Search
                    </Button>
                  </div>

                  {/* Active search provider indicator */}
                  {activeSearchProviderId && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200/50 dark:border-emerald-800/30">
                        <div className="h-2 w-2 rounded-full bg-emerald-500" />
                        <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
                          Active: {searchProviders.find(p => p.id === activeSearchProviderId)?.name || "Unknown"}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" onClick={handleTestSearch} disabled={isTestingSearch} className="gap-1.5">
                          {isTestingSearch ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                          Test Search
                        </Button>
                      </div>
                      {testSearchResults.length > 0 && (
                        <div className="rounded-lg border border-emerald-200/50 dark:border-emerald-800/30 bg-emerald-50/30 dark:bg-emerald-950/10 p-3 space-y-2">
                          <div className="text-xs font-medium text-emerald-700 dark:text-emerald-300 flex items-center gap-1">
                            <Check className="h-3 w-3" /> Search working — {testSearchResults.length} results
                          </div>
                          {testSearchResults.map((r, i) => (
                            <div key={i} className="text-[10px] space-y-0.5">
                              <div className="font-medium text-foreground truncate">{r.title}</div>
                              <div className="text-muted-foreground line-clamp-1">{r.snippet}</div>
                              <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline truncate block">{r.url}</a>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Add Search Provider Form */}
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
                              setSearchForm((prev) => ({ ...prev, name: e.target.value }))
                            }
                            className="h-9 text-sm"
                          />
                        </div>

                        <div className="space-y-1.5">
                          <Label className="text-xs">Provider Type</Label>
                          <Select
                            value={searchForm.type}
                            onValueChange={(value) =>
                              setSearchForm((prev) => ({ ...prev, type: value as SearchProviderType }))
                            }
                          >
                            <SelectTrigger className="h-9 text-sm">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {Object.entries(SEARCH_PROVIDER_INFO).map(([key, info]) => (
                                <SelectItem key={key} value={key}>
                                  {info.label}
                                </SelectItem>
                              ))}
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
                              placeholder={SEARCH_PROVIDER_INFO[searchForm.type].urlPlaceholder}
                              value={searchForm.baseUrl}
                              onChange={(e) =>
                                setSearchForm((prev) => ({ ...prev, baseUrl: e.target.value }))
                              }
                              className="h-9 text-sm"
                            />
                          </div>
                        )}

                        {SEARCH_PROVIDER_INFO[searchForm.type].needsKey && (
                          <div className="space-y-1.5">
                            <Label className="text-xs">API Key</Label>
                            <Input
                              type="password"
                              placeholder={SEARCH_PROVIDER_INFO[searchForm.type].keyPlaceholder}
                              value={searchForm.apiKey}
                              onChange={(e) =>
                                setSearchForm((prev) => ({ ...prev, apiKey: e.target.value }))
                              }
                              className="h-9 text-sm"
                            />
                          </div>
                        )}

                        {SEARCH_PROVIDER_INFO[searchForm.type].needsCxId && (
                          <div className="space-y-1.5">
                            <Label className="text-xs">Custom Search Engine ID (CX)</Label>
                            <Input
                              placeholder="e.g. 017576662..."
                              value={searchForm.cxId}
                              onChange={(e) =>
                                setSearchForm((prev) => ({ ...prev, cxId: e.target.value }))
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

                  {/* Existing Search Providers */}
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
                          <div className="flex items-start justify-between">
                            <div className="flex items-center gap-3">
                              <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 shrink-0">
                                <Search className="h-4 w-4" />
                              </div>
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="font-medium text-sm">
                                    {provider.name}
                                  </span>
                                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
                                    {SEARCH_PROVIDER_INFO[provider.type].label}
                                  </Badge>
                                  {activeSearchProviderId === provider.id && (
                                    <Badge className="text-[10px] px-1.5 py-0 h-4 bg-emerald-500 text-white">
                                      Active
                                    </Badge>
                                  )}
                                </div>
                                {provider.baseUrl && (
                                  <span className="text-[11px] text-muted-foreground font-mono truncate block max-w-[200px]">
                                    {provider.baseUrl}
                                  </span>
                                )}
                                {provider.apiKey && (
                                  <span className="text-[11px] text-muted-foreground font-mono">
                                    {showSearchApiKeys[provider.id]
                                      ? provider.apiKey
                                      : maskApiKey(provider.apiKey)}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Button
                                variant={activeSearchProviderId === provider.id ? "default" : "outline"}
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() => setActiveSearchProviderId(
                                  activeSearchProviderId === provider.id ? null : provider.id
                                )}
                              >
                                {activeSearchProviderId === provider.id ? "Active" : "Set Active"}
                              </Button>
                              <Switch
                                checked={provider.isEnabled}
                                onCheckedChange={(checked) =>
                                  updateSearchProvider(provider.id, { isEnabled: checked })
                                }
                              />
                            </div>
                          </div>

                          <div className="flex items-center justify-end">
                            <div className="flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() =>
                                  setShowSearchApiKeys((prev) => ({
                                    ...prev,
                                    [provider.id]: !prev[provider.id],
                                  }))
                                }
                              >
                                {showSearchApiKeys[provider.id] ? (
                                  <EyeOff className="h-3.5 w-3.5" />
                                ) : (
                                  <Eye className="h-3.5 w-3.5" />
                                )}
                              </Button>
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 text-destructive hover:text-destructive"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Remove Search Provider</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      Are you sure you want to remove {provider.name}?
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction
                                      onClick={() => handleRemoveSearchProvider(provider.id)}
                                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                    >
                                      Remove
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Search provider comparison */}
                <div className="rounded-lg bg-muted/50 p-4">
                  <h4 className="text-xs font-semibold flex items-center gap-2 mb-3">
                    <Globe className="h-3.5 w-3.5" />
                    Available Search Providers
                  </h4>
                  <div className="space-y-2">
                    {Object.entries(SEARCH_PROVIDER_INFO).map(([key, info]) => (
                      <div key={key} className="flex items-start gap-2 text-[11px]">
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 shrink-0 mt-0.5">
                          {info.label}
                        </Badge>
                        <span className="text-muted-foreground">{info.description}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <Separator />

                {/* Page Reader */}
                <div className="space-y-3">
                  <div>
                    <h3 className="text-sm font-semibold flex items-center gap-2">
                      <FileText className="h-4 w-4" />
                      Page Reader
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      Reads full web page content from search results for richer AI context
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Crawl4AI / Unified Proxy URL (optional)</Label>
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
                      Self-hosted Crawl4AI server or unified proxy URL. If using the Colab unified proxy, use the same URL as your provider base URL. Falls back to Jina Reader if not configured.
                    </p>
                  </div>
                  {pageReaderUrl && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200/50 dark:border-blue-800/30">
                      <div className="h-2 w-2 rounded-full bg-blue-500" />
                      <span className="text-xs font-medium text-blue-700 dark:text-blue-300">
                        Crawl4AI active — pages read via your server
                      </span>
                    </div>
                  )}
                  {!pageReaderUrl && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-800/30">
                      <div className="h-2 w-2 rounded-full bg-amber-500" />
                      <span className="text-xs text-amber-700 dark:text-amber-300">
                        Using Jina Reader (free fallback) — add Crawl4AI for self-hosted page reading
                      </span>
                    </div>
                  )}

                  {/* Unified Proxy Tip */}
                  <div className="rounded-lg bg-violet-50 dark:bg-violet-950/20 border border-violet-200/50 dark:border-violet-800/30 p-3">
                    <h4 className="text-[11px] font-semibold text-violet-700 dark:text-violet-300 flex items-center gap-1.5 mb-1.5">
                      <Zap className="h-3 w-3" /> Colab Unified Proxy Tip
                    </h4>
                    <p className="text-[10px] text-violet-600/80 dark:text-violet-400/80 leading-relaxed">
                      If you&apos;re using the Colab setup script, all services (Ollama, DuckDuckGo Search, Crawl4AI) run through a single proxy. Use the <strong>same base URL</strong> for:
                    </p>
                    <ul className="text-[10px] text-violet-600/80 dark:text-violet-400/80 mt-1 space-y-0.5">
                      <li>• AI Provider Base URL</li>
                      <li>• Search Provider Base URL (DuckDuckGo or SearXNG)</li>
                      <li>• Page Reader URL (this field)</li>
                    </ul>
                  </div>
                </div>
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
