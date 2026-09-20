import type { TModelSpec } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks/useLocalize';
import type { AgentModelDefault } from '~/utils';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

/** Models with no chat spec to borrow from get their name and line here. */
const FALLBACK_GUIDE: Record<string, { label: string; description: TranslationKeys }> = {
  'gpt-5.6-terra': { label: 'GPT-5.6 Terra', description: 'com_ui_model_guide_gpt_5_6_terra' },
};

export type ModelGuide = { label: string; description?: string };

/** The chat spec for this provider + model, so the cards say what the model menu says. */
export function getModelGuide(
  specs: TModelSpec[] | undefined,
  provider: string,
  model: string,
): ModelGuide {
  const spec = specs?.find((s) => s.preset.endpoint === provider && s.preset.model === model);
  return { label: spec?.label ?? model, description: spec?.description };
}

/** The default model leads the list; the rest keep the endpoint's order. */
export function orderModels(models: string[], defaultModel?: string): string[] {
  if (defaultModel == null || !models.includes(defaultModel)) {
    return models;
  }
  return [defaultModel, ...models.filter((model) => model !== defaultModel)];
}

type ModelCardsProps = {
  provider: string;
  models: string[];
  specs?: TModelSpec[];
  value: string;
  onChange: (model: string) => void;
  defaultModel?: AgentModelDefault;
  invalid?: boolean;
};

export default function ModelCards({
  provider,
  models,
  specs,
  value,
  onChange,
  defaultModel,
  invalid = false,
}: ModelCardsProps) {
  const localize = useLocalize();
  const isDefaultProvider = defaultModel?.provider === provider;
  return (
    <fieldset
      className={cn('flex flex-col gap-1.5 rounded-xl', invalid && 'ring-2 ring-red-500')}
      aria-describedby="model-cards-hint"
    >
      <legend className="sr-only">{localize('com_ui_model')}</legend>
      <p id="model-cards-hint" className="mb-1 text-xs text-text-secondary">
        {localize('com_ui_model_cards_hint')}
      </p>
      {orderModels(models, isDefaultProvider ? defaultModel?.model : undefined).map((model) => {
        const guide = getModelGuide(specs, provider, model);
        const fallback = FALLBACK_GUIDE[model];
        const label = guide.description != null ? guide.label : (fallback?.label ?? guide.label);
        const description =
          guide.description ?? (fallback ? localize(fallback.description) : undefined);
        const checked = model === value;
        const isDefault = isDefaultProvider && defaultModel?.model === model;
        return (
          <label
            key={model}
            className={cn(
              'relative block cursor-pointer rounded-xl border py-2 pl-9 pr-3 transition-colors hover:bg-surface-hover has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring-primary has-[:focus-visible]:ring-offset-2',
              checked
                ? 'border-ring-primary bg-surface-tertiary'
                : 'border-border-light bg-surface-primary',
            )}
          >
            <input
              type="radio"
              name="model-card"
              value={model}
              checked={checked}
              onChange={() => onChange(model)}
              className="absolute left-3 top-3"
            />
            <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm font-semibold text-text-primary">
              {label}
              {label !== model && (
                <span className="font-mono text-[11px] font-normal text-text-secondary">
                  {model}
                </span>
              )}
              {isDefault && (
                <span className="rounded-full border border-orange-200 bg-orange-50 px-2 text-[10px] font-bold uppercase tracking-wide text-orange-800 dark:border-orange-900 dark:bg-orange-950 dark:text-orange-300">
                  {localize('com_ui_model_default_badge')}
                </span>
              )}
            </span>
            {description && (
              <span className="mt-0.5 block text-xs leading-snug text-text-secondary">
                {description}
              </span>
            )}
          </label>
        );
      })}
    </fieldset>
  );
}
