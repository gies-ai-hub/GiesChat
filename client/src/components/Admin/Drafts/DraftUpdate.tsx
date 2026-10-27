import { useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import {
  Button,
  OGDialog,
  OGDialogTitle,
  OGDialogContent,
  useToastContext,
} from '@librechat/client';
import type {
  TModelSpec,
  AdminDraftChange,
  AdminDraftChoice,
  AdminDraftConflict,
} from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';
import {
  useGetStartupConfig,
  useAdminDraftUpdateQuery,
  useAdminAgentDraftsQuery,
  useUpdateAdminAgentDraftMutation,
} from '~/data-provider';
import { getModelLabel } from '~/components/SidePanel/Agents/ModelCards';
import { getResponseStatus } from '~/utils/errors';
import { NotificationSeverity } from '~/common';
import QueryState from '../QueryState';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

const FIELD_LABELS: Record<string, TranslationKeys> = {
  name: 'com_ui_name',
  description: 'com_ui_description',
  instructions: 'com_ui_instructions',
  avatar: 'com_ui_avatar',
  provider: 'com_ui_provider',
  model: 'com_ui_model',
  category: 'com_ui_category',
  course: 'com_ui_agent_course',
  conversation_starters: 'com_assistants_conversation_starters',
  tool_resources: 'com_ui_admin_draft_field_documents',
};

/** Fields whose values read as text; anything else (images, settings objects) shows "changed". */
const SHOWN_FIELDS = new Set(Object.keys(FIELD_LABELS).filter((field) => field !== 'avatar'));

const NOTICE =
  'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200';

interface DraftUpdateProps {
  /** The production agent the draft belongs to. */
  agentId: string;
  draftId: string;
  /** Shown inside the draft editor, where updating closes the editor first. */
  inEditor?: boolean;
  onUpdated?: () => void;
}

/**
 * The owner's notice that production moved past their draft, with the dialog that brings
 * the draft up to date. Renders nothing for anyone else's draft or a draft that is current.
 */
export default function DraftUpdate({ agentId, draftId, inEditor, onUpdated }: DraftUpdateProps) {
  const localize = useLocalize();
  const [open, setOpen] = useState(false);
  const { data } = useAdminAgentDraftsQuery(agentId);
  const draft = data?.drafts.find((item) => item.draft_id === draftId && item.mine);

  if (draft == null || data == null || draft.draftBase >= data.version) {
    return null;
  }
  const versions = { from: draft.draftBase, to: data.version };

  return (
    <div
      role="status"
      className={cn(
        'flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm',
        NOTICE,
      )}
    >
      <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
      <p className="min-w-0 flex-1">
        <span className="font-semibold">
          {localize('com_ui_admin_draft_update_notice', versions)}
        </span>{' '}
        {localize(
          inEditor ? 'com_ui_admin_draft_update_editor_hint' : 'com_ui_admin_draft_update_hint',
        )}
      </p>
      <Button size="sm" onClick={() => setOpen(true)}>
        {localize('com_ui_admin_draft_update')}
      </Button>
      <OGDialog open={open} onOpenChange={setOpen}>
        <OGDialogContent className="max-h-[90vh] w-11/12 max-w-2xl overflow-y-auto">
          {open && (
            <UpdateDialogBody
              agentId={agentId}
              draftId={draftId}
              versions={versions}
              onClose={() => setOpen(false)}
              onUpdated={onUpdated}
            />
          )}
        </OGDialogContent>
      </OGDialog>
    </div>
  );
}

function UpdateDialogBody({
  agentId,
  draftId,
  versions,
  onClose,
  onUpdated,
}: {
  agentId: string;
  draftId: string;
  /** From the drafts list, shown until the preview (which may be newer) arrives. */
  versions: { from: number; to: number };
  onClose: () => void;
  onUpdated?: () => void;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const { data: startupConfig } = useGetStartupConfig();
  const { data, isLoading, error, refetch } = useAdminDraftUpdateQuery(agentId, draftId);
  const update = useUpdateAdminAgentDraftMutation();
  const [choices, setChoices] = useState<Record<string, AdminDraftChoice>>({});

  const specs = startupConfig?.modelSpecs?.list;
  const from = data?.from ?? versions.from;
  const to = data?.to ?? versions.to;
  const conflicts = data?.conflicts ?? [];
  const left = conflicts.filter((conflict) => choices[conflict.id] == null).length;
  const [incoming, kept] = useMemo(() => {
    const changes = data?.changes ?? [];
    return [
      changes.filter((change) => change.from === 'production'),
      changes.filter((change) => change.from === 'draft'),
    ];
  }, [data]);

  const fieldLabel = (field: string) =>
    localize(FIELD_LABELS[field] ?? 'com_ui_admin_draft_field_other');
  const value = (field: string, text: string) => {
    if (text === '') {
      return localize('com_ui_admin_draft_update_empty');
    }
    return field === 'model' ? modelName(specs, text) : text;
  };

  const apply = () => {
    if (data == null) {
      return;
    }
    update.mutate(
      { agentId, draftId, payload: { to: data.to, choices } },
      {
        onSuccess: (result) => {
          showToast({
            message: localize('com_ui_admin_draft_update_success', { to: result.draftBase }),
            severity: NotificationSeverity.SUCCESS,
          });
          onClose();
          onUpdated?.();
        },
        onError: (err) => {
          const moved = getResponseStatus(err) === 409;
          if (moved) {
            setChoices({});
          }
          showToast({
            message: localize(
              moved ? 'com_ui_admin_draft_update_moved' : 'com_ui_admin_draft_update_error',
            ),
            severity: moved ? NotificationSeverity.WARNING : NotificationSeverity.ERROR,
          });
        },
      },
    );
  };

  const footerHint = () => {
    if (left > 0) {
      return localize('com_ui_admin_draft_update_hint_left', { count: left });
    }
    if (conflicts.length > 0) {
      return localize('com_ui_admin_draft_update_hint_ready');
    }
    return localize('com_ui_admin_draft_update_hint_clean', { from });
  };

  return (
    <>
      <OGDialogTitle>{localize('com_ui_admin_draft_update_title', { to })}</OGDialogTitle>
      <QueryState
        isLoading={isLoading}
        error={error}
        isEmpty={incoming.length + kept.length + conflicts.length === 0}
        emptyKey="com_ui_admin_draft_update_nothing"
        errorKey="com_ui_admin_draft_update_load_error"
        onRetry={() => void refetch()}
      >
        <p className="text-sm text-text-secondary">
          {localize('com_ui_admin_draft_update_subtitle', { from, to })}
        </p>
        <ChangeList
          title={localize('com_ui_admin_draft_update_incoming')}
          tag={localize('com_ui_admin_draft_update_tag_production')}
          changes={incoming}
          fieldLabel={fieldLabel}
          value={value}
          changedText={localize('com_ui_admin_draft_update_changed')}
        />
        <ChangeList
          title={localize('com_ui_admin_draft_update_kept')}
          tag={localize('com_ui_admin_draft_update_tag_yours')}
          changes={kept}
          fieldLabel={fieldLabel}
          value={value}
          changedText={localize('com_ui_admin_draft_update_changed')}
        />
        {conflicts.length > 0 && (
          <section className="mt-4" aria-labelledby="draft-update-conflicts">
            <h3
              id="draft-update-conflicts"
              className="mb-2 text-sm font-semibold text-text-primary"
            >
              {localize('com_ui_admin_draft_update_conflicts', { count: left })}
            </h3>
            <div className="flex flex-col gap-2">
              {conflicts.map((conflict) => (
                <ConflictPicker
                  key={conflict.id}
                  conflict={conflict}
                  label={fieldLabel(conflict.field)}
                  value={value}
                  choice={choices[conflict.id]}
                  onChoose={(choice) =>
                    setChoices((current) => ({ ...current, [conflict.id]: choice }))
                  }
                />
              ))}
            </div>
          </section>
        )}
      </QueryState>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border-light pt-3">
        <p className="text-xs text-text-secondary" aria-live="polite">
          {data != null && footerHint()}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose} disabled={update.isLoading}>
            {localize('com_ui_admin_draft_update_later', { from })}
          </Button>
          <Button onClick={apply} disabled={data == null || left > 0 || update.isLoading}>
            {localize('com_ui_admin_draft_update')}
          </Button>
        </div>
      </div>
    </>
  );
}

/** The chat spec's label when one runs this model, else the builder's fallback name. */
function modelName(specs: TModelSpec[] | undefined, model: string): string {
  return (
    specs?.find((spec) => spec.preset.model === model)?.label ?? getModelLabel(specs, '', model)
  );
}

function ChangeList({
  title,
  tag,
  changes,
  fieldLabel,
  value,
  changedText,
}: {
  title: string;
  tag: string;
  changes: AdminDraftChange[];
  fieldLabel: (field: string) => string;
  value: (field: string, text: string) => string;
  changedText: string;
}) {
  if (changes.length === 0) {
    return null;
  }
  return (
    <section className="mt-4">
      <h3 className="mb-2 text-sm font-semibold text-text-primary">{title}</h3>
      <ul className="flex flex-col gap-1.5">
        {changes.map((change, index) => (
          <li
            key={`${change.field}-${index}`}
            className="rounded-lg border border-border-light bg-surface-primary px-3 py-2 text-sm"
          >
            <span className="mr-2 rounded bg-surface-tertiary px-1.5 py-0.5 text-[11px] font-semibold text-text-primary">
              {tag}
            </span>
            <span className="font-semibold text-text-primary">{fieldLabel(change.field)}</span>
            <ChangeValue change={change} value={value} changedText={changedText} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function ChangeValue({
  change,
  value,
  changedText,
}: {
  change: AdminDraftChange;
  value: (field: string, text: string) => string;
  changedText: string;
}) {
  if (!SHOWN_FIELDS.has(change.field)) {
    return <span className="text-text-secondary">: {changedText}</span>;
  }
  if (change.before != null) {
    return (
      <span className="text-text-secondary">
        : {value(change.field, change.before)} → {value(change.field, change.after)}
      </span>
    );
  }
  return (
    <ul className="mt-1 flex flex-col gap-0.5">
      {change.after.split('\n').map((line, index) => (
        <li key={index} className="whitespace-pre-wrap break-words text-text-secondary">
          {change.field === 'instructions' ? `“${line}”` : line}
        </li>
      ))}
    </ul>
  );
}

function ConflictPicker({
  conflict,
  label,
  value,
  choice,
  onChoose,
}: {
  conflict: AdminDraftConflict;
  label: string;
  value: (field: string, text: string) => string;
  choice: AdminDraftChoice | undefined;
  onChoose: (choice: AdminDraftChoice) => void;
}) {
  const localize = useLocalize();
  const options: { choice: AdminDraftChoice; who: string; text: string }[] = [
    { choice: 'mine', who: localize('com_ui_admin_draft_update_yours'), text: conflict.mine },
    { choice: 'theirs', who: localize('com_ui_admin_draft_update_theirs'), text: conflict.theirs },
  ];
  return (
    <fieldset className={cn('rounded-lg border p-3', NOTICE)}>
      <legend className="px-1 text-sm font-semibold">
        {localize('com_ui_admin_draft_update_conflict', { field: label })}
      </legend>
      {conflict.context != null && (
        <p className="mb-2 whitespace-pre-wrap font-mono text-xs opacity-80">{conflict.context}</p>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((option) => {
          const checked = choice === option.choice;
          return (
            <label
              key={option.choice}
              className={cn(
                'block cursor-pointer rounded-lg border-2 bg-surface-primary p-2 text-text-primary focus-within:ring-2 focus-within:ring-[var(--illini-orange)]',
                checked ? 'border-[var(--illini-orange)]' : 'border-border-light',
              )}
            >
              <span className="flex items-center gap-2 text-xs font-semibold uppercase text-text-secondary">
                <input
                  type="radio"
                  name={`draft-conflict-${conflict.id}`}
                  value={option.choice}
                  checked={checked}
                  onChange={() => onChoose(option.choice)}
                  className="accent-[var(--illini-orange)]"
                />
                {option.who}
              </span>
              <span className="mt-1 block whitespace-pre-wrap break-words font-mono text-xs">
                {SHOWN_FIELDS.has(conflict.field) ? value(conflict.field, option.text) : option.who}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
