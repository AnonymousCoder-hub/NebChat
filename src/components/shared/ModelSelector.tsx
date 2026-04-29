"use client";

import { useAppStore } from "@/lib/store";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ModelInfo } from "@/lib/types";

interface ModelSelectorProps {
  onModelSelect?: (modelId: string, providerId: string) => void;
  selectedModelId?: string | null;
  selectedProviderId?: string | null;
}

export function ModelSelector({
  onModelSelect,
  selectedModelId,
  selectedProviderId,
}: ModelSelectorProps) {
  const { providers } = useAppStore();
  const enabledProviders = providers.filter((p) => p.isEnabled && p.models.length > 0);

  if (enabledProviders.length === 0) {
    return (
      <div className="text-sm text-muted-foreground px-3 py-2 bg-muted/50 rounded-md">
        No models available. Add a provider in Settings.
      </div>
    );
  }

  const currentValue = selectedModelId && selectedProviderId
    ? `${selectedProviderId}::${selectedModelId}`
    : "";

  return (
    <Select
      value={currentValue}
      onValueChange={(value) => {
        const [providerId, modelId] = value.split("::");
        onModelSelect?.(modelId, providerId);
      }}
    >
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Select a model..." />
      </SelectTrigger>
      <SelectContent>
        {enabledProviders.map((provider) => (
          <SelectGroup key={provider.id}>
            <SelectLabel className="text-xs text-muted-foreground">
              {provider.name}
            </SelectLabel>
            {provider.models.map((model) => (
              <SelectItem
                key={`${provider.id}::${model.id}`}
                value={`${provider.id}::${model.id}`}
                className="text-sm"
              >
                {model.name || model.id}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}
