"use client";

import { useAppStore } from "@/lib/store";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sparkles,
  Plus,
  Settings,
  Server,
  MessageSquare,
  Zap,
  ArrowRight,
  Key,
  Shield,
} from "lucide-react";

export function HomeView() {
  const { providers, createConversation, setSelectedModel, setSettingsOpen } =
    useAppStore();

  const enabledProviders = providers.filter((p) => p.isEnabled);
  const allModels = enabledProviders.flatMap((p) =>
    p.models.map((m) => ({
      ...m,
      providerName: p.name,
      providerId: p.id,
      providerBaseUrl: p.baseUrl,
    }))
  );

  const handleStartChat = (modelId: string, providerId: string) => {
    setSelectedModel(modelId, providerId);
    createConversation(modelId, providerId);
  };

  // Empty state
  if (providers.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="max-w-md w-full text-center space-y-6">
          <div className="mx-auto w-20 h-20 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Sparkles className="h-10 w-10 text-primary" />
          </div>
          <div className="space-y-2">
            <h2 className="text-2xl font-bold tracking-tight">
              Welcome to NebChat
            </h2>
            <p className="text-muted-foreground text-sm">
              Your private AI chat interface. Bring your own API key and start
              chatting with any OpenAI-compatible model.
            </p>
          </div>
          <div className="space-y-3">
            <Button
              className="w-full gap-2"
              size="lg"
              onClick={() => setSettingsOpen(true)}
            >
              <Plus className="h-4 w-4" />
              Add Your First Provider
            </Button>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="rounded-lg bg-muted/50 p-3">
                <Key className="h-5 w-5 mx-auto mb-1.5 text-muted-foreground" />
                <p className="text-[10px] text-muted-foreground">BYOK</p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <Shield className="h-5 w-5 mx-auto mb-1.5 text-muted-foreground" />
                <p className="text-[10px] text-muted-foreground">Private</p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <Zap className="h-5 w-5 mx-auto mb-1.5 text-muted-foreground" />
                <p className="text-[10px] text-muted-foreground">Fast</p>
              </div>
            </div>
          </div>
          <div className="text-xs text-muted-foreground/60 space-y-1">
            <p>Supports OpenAI, Groq, Together, Mistral, Ollama & more</p>
            <p>All data stays in your browser</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-4xl mx-auto p-6 space-y-8">
        {/* Header */}
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center h-10 w-10 rounded-xl bg-primary text-primary-foreground">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">NebChat</h1>
              <p className="text-sm text-muted-foreground">
                Choose a model and start chatting
              </p>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card className="bg-muted/30">
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                <Server className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-xl font-bold">{providers.length}</p>
                  <p className="text-[10px] text-muted-foreground">Providers</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-muted/30">
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-amber-500" />
                <div>
                  <p className="text-xl font-bold">{allModels.length}</p>
                  <p className="text-[10px] text-muted-foreground">Models</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-muted/30">
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-emerald-500" />
                <div>
                  <p className="text-xl font-bold">
                    {useAppStore.getState().conversations.length}
                  </p>
                  <p className="text-[10px] text-muted-foreground">Chats</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-muted/30">
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-rose-500" />
                <div>
                  <p className="text-xl font-bold">100%</p>
                  <p className="text-[10px] text-muted-foreground">Private</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Models by Provider */}
        {enabledProviders.length === 0 ? (
          <div className="text-center py-12 space-y-4">
            <Server className="h-12 w-12 mx-auto text-muted-foreground/30" />
            <div>
              <p className="font-medium text-muted-foreground">
                No active providers
              </p>
              <p className="text-sm text-muted-foreground/60">
                Enable a provider or add a new one
              </p>
            </div>
            <Button onClick={() => setSettingsOpen(true)} className="gap-2">
              <Settings className="h-4 w-4" />
              Open Settings
            </Button>
          </div>
        ) : (
          <div className="space-y-6">
            {enabledProviders.map((provider) => (
              <div key={provider.id} className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-emerald-500" />
                    <h3 className="text-sm font-semibold">{provider.name}</h3>
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
                      {provider.models.length} models
                    </Badge>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs text-muted-foreground"
                    onClick={() => setSettingsOpen(true)}
                  >
                    Manage
                  </Button>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {provider.models.map((model) => (
                    <Card
                      key={model.id}
                      className="group cursor-pointer hover:border-primary/30 hover:bg-accent/50 transition-all duration-200"
                      onClick={() => handleStartChat(model.id, provider.id)}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium truncate">
                              {model.name || model.id}
                            </p>
                            <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                              {model.id}
                            </p>
                            {model.owned_by && (
                              <p className="text-[10px] text-muted-foreground/60 mt-1">
                                by {model.owned_by}
                              </p>
                            )}
                          </div>
                          <ArrowRight className="h-4 w-4 text-muted-foreground/0 group-hover:text-primary transition-colors shrink-0 mt-0.5" />
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Quick Start Tips */}
        {allModels.length > 0 && (
          <div className="rounded-lg bg-muted/30 border p-4">
            <h4 className="text-xs font-semibold mb-2">Quick Tips</h4>
            <ul className="text-[11px] text-muted-foreground space-y-1">
              <li>• Click any model card above to start a new conversation</li>
              <li>• Use the sidebar to switch between conversations</li>
              <li>• Your chat history is saved in your browser automatically</li>
              <li>• Add more providers anytime from Settings</li>
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}


