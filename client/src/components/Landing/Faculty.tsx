import { useState } from 'react';
import type { ReactNode } from 'react';
import type { TranslationKeys } from '~/hooks';
import { DashboardScene } from './Reel';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

const STEPS: Array<[TranslationKeys, TranslationKeys]> = [
  ['com_ui_landing_tour_build', 'com_ui_landing_tour_build_body'],
  ['com_ui_landing_tour_test', 'com_ui_landing_tour_test_body'],
  ['com_ui_landing_tour_share', 'com_ui_landing_tour_share_body'],
  ['com_ui_landing_tour_usage', 'com_ui_landing_tour_usage_body'],
];
const LUNA = 'GPT-6 Luna';
const SONNET = 'Claude Sonnet 5.5';
const FILES: TranslationKeys[] = [
  'com_ui_landing_tour_file1',
  'com_ui_landing_tour_file2',
  'com_ui_landing_tour_file3',
];
const SITE = 'finance.gies.illinois.edu/office-hours';
const SNIPPET =
  '<iframe src="https://gieschat.azurewebsites.net/embed/3f9c…"\n  title="Finance Office Hours" width="100%" height="640"></iframe>';
const TAS: Array<[string, string]> = [
  ['MR', '#1d4ed8'],
  ['JL', '#c84113'],
];

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="lp-field">
      <span>{label}</span>
      {children}
    </div>
  );
}

function BuildScreen() {
  const localize = useLocalize();
  return (
    <>
      <div className="lp-head">
        <b>{localize('com_ui_landing_tour_create')}</b>
        <span className="lp-btn lp-btn-sm lp-navy">
          {localize('com_ui_landing_tour_create_btn')}
        </span>
      </div>
      <div className="lp-form">
        <Field label={localize('com_ui_landing_tour_name')}>
          <div className="lp-input">
            <b>{localize('com_ui_landing_tour_agent')}</b> ·{' '}
            {localize('com_ui_landing_tour_agent_desc')}
          </div>
        </Field>
        <Field label={localize('com_ui_landing_tour_model')}>
          <div className="lp-models">
            <div className="lp-model-card lp-picked">
              {LUNA}
              <span className="lp-badge">{localize('com_ui_model_default_badge')}</span>
              <small>{localize('com_ui_landing_tour_luna')}</small>
            </div>
            <div className="lp-model-card">
              {SONNET}
              <small>{localize('com_ui_model_guide_sonnet')}</small>
            </div>
          </div>
        </Field>
        <Field label={localize('com_ui_landing_tour_instructions')}>
          <div className="lp-input">{localize('com_ui_landing_tour_instructions_text')}</div>
        </Field>
        <Field label={localize('com_ui_landing_tour_documents')}>
          <div className="lp-files">
            {FILES.map((file) => (
              <span key={file} className="lp-file">
                <b>PDF</b>
                {localize(file)}
              </span>
            ))}
          </div>
        </Field>
        <Field label={localize('com_ui_landing_tour_websites')}>
          <div className="lp-files">
            <span className="lp-chip">{SITE}</span>
            <span className="lp-chip lp-saved">{localize('com_ui_landing_tour_saved')}</span>
          </div>
        </Field>
      </div>
    </>
  );
}

function TestScreen() {
  const localize = useLocalize();
  return (
    <>
      <div className="lp-head">
        <b>{localize('com_ui_landing_tour_test_title')}</b>
        <span className="lp-chip">{localize('com_ui_landing_tour_test_count')}</span>
      </div>
      <div className="lp-form">
        <p className="lp-note">{localize('com_ui_landing_tour_test_note')}</p>
        <div className="lp-input">{localize('com_ui_landing_tutor_q')}</div>
        <div className="lp-answers">
          {(
            [
              [LUNA, 'com_ui_landing_tutor_a'],
              [SONNET, 'com_ui_landing_tour_sonnet_a'],
            ] as Array<[string, TranslationKeys]>
          ).map(([model, answer]) => (
            <div key={model} className="lp-answer">
              <b>{model}</b>
              {localize(answer)}
            </div>
          ))}
        </div>
        <div className="lp-files">
          <span className="lp-btn lp-btn-sm lp-outline">
            {localize('com_ui_landing_tour_use', { 0: LUNA })}
          </span>
          <span className="lp-btn lp-btn-sm lp-outline">
            {localize('com_ui_landing_tour_use', { 0: SONNET })}
          </span>
        </div>
      </div>
    </>
  );
}

function ShareScreen() {
  const localize = useLocalize();
  return (
    <>
      <div className="lp-head">
        <b>{localize('com_ui_landing_tab_embed')}</b>
        <span className="lp-tas" aria-hidden="true">
          {TAS.map(([initials, color]) => (
            <i key={initials} style={{ background: color }}>
              {initials}
            </i>
          ))}
        </span>
      </div>
      <div className="lp-form">
        <p className="lp-note">{localize('com_ui_landing_tour_tas')}</p>
        <Field label={localize('com_ui_landing_tour_audience')}>
          <div className="lp-radio lp-picked">{localize('com_ui_landing_tour_illinois')}</div>
          <div className="lp-radio">{localize('com_ui_landing_tour_anyone')}</div>
        </Field>
        <Field label={localize('com_ui_landing_tour_greeting')}>
          <div className="lp-input">{localize('com_ui_landing_tour_greeting_text')}</div>
        </Field>
        <Field label={localize('com_ui_landing_tour_paste')}>
          <pre className="lp-snippet">{SNIPPET}</pre>
        </Field>
      </div>
    </>
  );
}

/**
 * The faculty section's walk through the class dashboard: four step buttons swap a hand-built
 * screen beside them. No autoplay, so it never competes with the hero reel.
 */
export default function Faculty({ children }: { children: ReactNode }) {
  const localize = useLocalize();
  const [active, setActive] = useState(0);
  const screens = [
    <BuildScreen key="build" />,
    <TestScreen key="test" />,
    <ShareScreen key="share" />,
    <DashboardScene key="usage" active={active === 3} />,
  ];
  return (
    <div className="lp-tour">
      <div>
        <div className="lp-steps" role="group" aria-label={localize('com_ui_landing_tour_label')}>
          {STEPS.map(([title, body], i) => (
            <button
              key={title}
              type="button"
              className="lp-step"
              aria-pressed={i === active}
              aria-controls="lp-tour-screen"
              onClick={() => setActive(i)}
            >
              <b>
                <span aria-hidden="true">{i + 1}</span>
                {localize(title)}
              </b>
              <p>{localize(body)}</p>
            </button>
          ))}
        </div>
        <div className="lp-ctas lp-tour-ctas">{children}</div>
      </div>
      <div className="lp-window lp-tour-window" id="lp-tour-screen">
        {screens.map((screen, i) => (
          <div
            key={STEPS[i][0]}
            className={cn('lp-tour-screen', i === active && 'lp-play')}
            hidden={i !== active}
          >
            {screen}
          </div>
        ))}
      </div>
    </div>
  );
}
