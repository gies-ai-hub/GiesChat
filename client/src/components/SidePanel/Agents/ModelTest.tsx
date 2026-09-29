import { useState } from 'react';
import { Scale, X } from 'lucide-react';
import { isEphemeralAgentId } from 'librechat-data-provider';
import { Button, OGDialog, OGDialogTitle, OGDialogContent } from '@librechat/client';
import type { TModelSpec, AdminModelTestAnswer } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks/useLocalize';
import { useRunAdminModelTestMutation } from '~/data-provider';
import { getModelLabel } from './ModelCards';
import { useLocalize } from '~/hooks';
import { RETIRED_MODELS } from '~/utils';

/** Must match `MODEL_TEST_MAX_QUESTIONS` on the server. */
const MAX_QUESTIONS = 5;
const QUESTION_MAX = 500;

type ModelTestProps = {
  provider: string;
  models: string[];
  specs?: TModelSpec[];
  current: string;
  agentId: string;
  instructions: string;
  onUse: (model: string) => void;
};

/** Second choice defaults to the first other model, so a fresh dialog is one click from a run. */
const pickOther = (models: string[], taken: string) =>
  models.find((model) => model !== taken) ?? '';

export default function ModelTest({
  provider,
  models,
  specs,
  current,
  agentId,
  instructions,
  onUse,
}: ModelTestProps) {
  const localize = useLocalize();
  const run = useRunAdminModelTestMutation();
  const offered = models.filter((model) => !RETIRED_MODELS.has(model));
  const [open, setOpen] = useState(false);
  const [modelA, setModelA] = useState('');
  const [modelB, setModelB] = useState('');
  const [questions, setQuestions] = useState<string[]>(['']);
  const [problem, setProblem] = useState<string | null>(null);

  const saved = agentId !== '' && !isEphemeralAgentId(agentId);
  const label = (model: string) => getModelLabel(specs, provider, model);

  const openDialog = () => {
    const first = offered.includes(current) ? current : (offered[0] ?? '');
    setModelA(first);
    setModelB(pickOther(offered, first));
    setProblem(null);
    run.reset();
    setOpen(true);
  };

  const start = () => {
    const asked = questions.map((question) => question.trim()).filter(Boolean);
    if (modelA === modelB) {
      setProblem(localize('com_ui_model_test_same'));
      return;
    }
    if (asked.length === 0) {
      setProblem(localize('com_ui_model_test_no_questions'));
      return;
    }
    setProblem(null);
    run.mutate({
      agent_id: saved ? agentId : undefined,
      instructions,
      models: [modelA, modelB],
      questions: asked,
    });
  };

  const use = (model: string) => {
    onUse(model);
    setOpen(false);
  };

  const renderAnswer = (answer: AdminModelTestAnswer | undefined, model: string) => (
    <div className="whitespace-pre-wrap rounded-lg border border-border-light p-2 text-sm text-text-primary">
      {answer?.error != null ? (
        <span className="text-red-500">{answer.error}</span>
      ) : (
        (answer?.text ?? '')
      )}
      {answer != null && (
        <span className="mt-1 block text-xs text-text-secondary">
          {localize('com_ui_model_test_time', {
            model: label(model),
            seconds: (answer.ms / 1000).toFixed(1),
          })}
        </span>
      )}
    </div>
  );

  const pickers: {
    id: string;
    key: TranslationKeys;
    value: string;
    set: (model: string) => void;
  }[] = [
    { id: 'model-test-a', key: 'com_ui_model_test_a', value: modelA, set: setModelA },
    { id: 'model-test-b', key: 'com_ui_model_test_b', value: modelB, set: setModelB },
  ];
  const selectClass =
    'w-full rounded-lg border border-border-light bg-surface-primary px-2 py-1.5 text-sm text-text-primary';
  const results = run.data?.results ?? [];
  let runKey: TranslationKeys =
    results.length > 0 ? 'com_ui_model_test_again' : 'com_ui_model_test_run';
  if (run.isLoading) {
    runKey = 'com_ui_model_test_running';
  }

  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={openDialog}>
        <Scale className="mr-1 size-4" aria-hidden="true" />
        {localize('com_ui_model_test')}
      </Button>
      <OGDialog open={open} onOpenChange={setOpen}>
        <OGDialogContent className="max-h-[90vh] w-11/12 max-w-4xl overflow-y-auto">
          <OGDialogTitle>{localize('com_ui_model_test')}</OGDialogTitle>
          <p className="text-sm text-text-secondary">
            {localize(saved ? 'com_ui_model_test_intro' : 'com_ui_model_test_intro_new')}
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {pickers.map((picker) => (
              <label key={picker.id} htmlFor={picker.id} className="text-sm text-text-secondary">
                {localize(picker.key)}
                <select
                  id={picker.id}
                  value={picker.value}
                  onChange={(event) => picker.set(event.target.value)}
                  className={selectClass}
                >
                  {offered.map((model) => (
                    <option key={model} value={model}>
                      {label(model)}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between">
            <span className="text-sm font-medium text-text-primary">
              {localize('com_ui_model_test_questions', { max: MAX_QUESTIONS })}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={questions.length >= MAX_QUESTIONS}
              onClick={() => setQuestions((current) => [...current, ''])}
            >
              {localize('com_ui_model_test_add')}
            </Button>
          </div>
          <div className="mt-2 flex flex-col gap-2">
            {questions.map((question, index) => (
              <div key={index} className="flex gap-2">
                <input
                  id={`model-test-question-${index}`}
                  type="text"
                  value={question}
                  maxLength={QUESTION_MAX}
                  aria-label={localize('com_ui_model_test_question', { n: index + 1 })}
                  placeholder={localize('com_ui_model_test_placeholder')}
                  onChange={(event) =>
                    setQuestions((current) =>
                      current.map((entry, at) => (at === index ? event.target.value : entry)),
                    )
                  }
                  className="w-full rounded-lg border border-border-light bg-surface-primary px-3 py-2 text-sm text-text-primary"
                />
                {questions.length > 1 && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={localize('com_ui_model_test_remove', { n: index + 1 })}
                    onClick={() =>
                      setQuestions((current) => current.filter((_, at) => at !== index))
                    }
                  >
                    <X className="size-4" aria-hidden="true" />
                  </Button>
                )}
              </div>
            ))}
          </div>
          {problem != null && (
            <p role="alert" className="mt-2 text-sm text-red-500">
              {problem}
            </p>
          )}
          {run.isError && (
            <p role="alert" className="mt-2 text-sm text-red-500">
              {localize('com_ui_model_test_error')}
            </p>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {localize('com_ui_close')}
            </Button>
            <Button type="button" onClick={start} disabled={run.isLoading || offered.length < 2}>
              {localize(runKey)}
            </Button>
          </div>
          {results.length > 0 && (
            <section aria-label={localize('com_ui_model_test_results')} className="mt-4">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {results.map((result, index) => (
                  <div key={index} className="contents">
                    <p className="text-sm font-semibold text-text-primary sm:col-span-2">
                      {`${index + 1}. ${result.question}`}
                    </p>
                    {renderAnswer(result.answers[0], result.answers[0]?.model ?? modelA)}
                    {renderAnswer(result.answers[1], result.answers[1]?.model ?? modelB)}
                  </div>
                ))}
              </div>
              <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {(results[0]?.answers ?? []).map((answer) => (
                  <Button key={answer.model} type="button" onClick={() => use(answer.model)}>
                    {localize('com_ui_model_test_use', { model: label(answer.model) })}
                  </Button>
                ))}
              </div>
              <p className="mt-2 text-xs text-text-secondary">
                {localize('com_ui_model_test_use_hint')}
              </p>
            </section>
          )}
        </OGDialogContent>
      </OGDialog>
    </>
  );
}
