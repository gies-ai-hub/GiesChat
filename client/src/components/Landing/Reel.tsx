import { Plus } from 'lucide-react';
import { useRef, useState, useEffect, useCallback } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { TranslationKeys } from '~/hooks';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

const SCENE_MS = 4000;
/** Scenes are authored on a slower clock; this compresses every entrance to fit SCENE_MS. */
const PACE = 0.65;
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';
const TABS: TranslationKeys[] = [
  'com_ui_landing_tab_tutors',
  'com_ui_landing_tab_deck',
  'com_ui_landing_builder_title',
  'com_ui_landing_tab_dashboard',
  'com_ui_landing_tab_embed',
];
const TUTOR_MODEL = 'GPT-6 Luna';
const DECK_MODEL = 'GPT-6.1 Sol';
const REPLIT = 'Replit';
const CHART = [34, 52, 47, 78, 96, 41, 22];
/** 2026-10-12 is a Monday; Intl gives localized weekday names without translation keys. */
const WEEKDAYS = CHART.map((_, i) =>
  new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(new Date(2026, 9, 12 + i)),
);
const TOPICS: Array<[TranslationKeys, number]> = [
  ['com_ui_landing_topic1', 31],
  ['com_ui_landing_topic2', 24],
  ['com_ui_landing_topic3', 18],
  ['com_ui_landing_topic4', 9],
];
const GOING = ['JK', 'AR', 'MS', 'DL'];

const prefersStill = () => window.matchMedia(REDUCED_MOTION).matches;

/** Staggered entrance: CSS starts an `.lp-a` element `delay` seconds after its scene plays. */
const at = (delay: number, extra?: Record<string, string>) =>
  ({ '--d': `${delay * PACE}s`, ...extra }) as CSSProperties;

function Typing({ delay, length }: { delay: number; length: number }) {
  return (
    <span
      className="lp-dots"
      style={at(delay, { '--len': `${length * PACE}s` })}
      aria-hidden="true"
    >
      <i />
      <i />
      <i />
    </span>
  );
}

function BotMessage({
  avatar,
  name,
  delay,
  typing,
  children,
}: {
  avatar: string;
  name?: string;
  delay: number;
  typing?: number;
  children: ReactNode;
}) {
  return (
    <div className="lp-msg-bot lp-a" style={at(delay)}>
      <span className="lp-avatar" aria-hidden="true">
        {avatar}
      </span>
      <div>
        {name != null && <div className="lp-who">{name}</div>}
        <div className="lp-body">
          {typing == null ? (
            children
          ) : (
            <>
              <Typing delay={delay} length={typing} />
              <span className="lp-a" style={at(delay + typing)}>
                {children}
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Counts up from zero each time its scene starts playing. */
function Count({ to, decimals = 0, active }: { to: number; decimals?: number; active: boolean }) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!active || prefersStill()) {
      setValue(active ? to : 0);
      return;
    }
    const start = performance.now() + 200;
    let frame = 0;
    const step = (now: number) => {
      const k = Math.min(1, Math.max(0, (now - start) / 600));
      setValue(to * (1 - Math.pow(1 - k, 3)));
      if (k < 1) {
        frame = requestAnimationFrame(step);
      }
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [active, to]);
  return <>{value.toFixed(decimals)}</>;
}

function TutorScene() {
  const localize = useLocalize();
  const tutor = localize('com_ui_landing_tutor_name');
  return (
    <div className="lp-app">
      <aside className="lp-side">
        <div className="lp-side-new">
          <Plus className="size-3.5" aria-hidden="true" />
          {localize('com_ui_new_chat')}
        </div>
        <div className="lp-side-label">{localize('com_ui_date_today')}</div>
        <div className="lp-conv lp-conv-on">{localize('com_ui_landing_conv1')}</div>
        <div className="lp-conv">{localize('com_ui_landing_conv2')}</div>
        <div className="lp-side-label">{localize('com_ui_date_yesterday')}</div>
        <div className="lp-conv">{localize('com_ui_landing_conv3')}</div>
        <div className="lp-conv">{localize('com_ui_landing_conv4')}</div>
        <div className="lp-conv">{localize('com_ui_landing_conv5')}</div>
      </aside>
      <section className="lp-main">
        <div className="lp-head">
          <span className="lp-head-left">
            <span className="lp-chip">
              <i />
              {tutor}
            </span>
            <span className="lp-model">{TUTOR_MODEL}</span>
          </span>
        </div>
        <div className="lp-msgs">
          <div className="lp-msg-user lp-a" style={at(0.2)}>
            {localize('com_ui_landing_tutor_q')}
          </div>
          <BotMessage avatar="FT" name={tutor} delay={0.7} typing={1.3}>
            {localize('com_ui_landing_tutor_a')}
          </BotMessage>
          <div className="lp-msg-user lp-a" style={at(3.4)}>
            {localize('com_ui_landing_tutor_q2')}
          </div>
        </div>
        <div className="lp-composer">
          <span>{localize('com_ui_landing_message', { 0: tutor })}</span>
          <span className="lp-send" aria-hidden="true">
            ↑
          </span>
        </div>
      </section>
    </div>
  );
}

function DeckScene() {
  const localize = useLocalize();
  const name = localize('com_ui_landing_tab_deck');
  return (
    <div className="lp-deck">
      <div className="lp-deck-chat">
        <div className="lp-head">
          <span className="lp-head-left">
            <span className="lp-chip">
              <i />
              {name}
            </span>
            <span className="lp-model">{DECK_MODEL}</span>
          </span>
        </div>
        <div className="lp-msgs">
          <div className="lp-msg-user lp-a" style={at(0.2)}>
            {localize('com_ui_landing_deck_q')}
          </div>
          <BotMessage avatar="DB" name={name} delay={0.7} typing={1}>
            {localize('com_ui_landing_deck_a')}
          </BotMessage>
        </div>
      </div>
      <div className="lp-deck-preview">
        <div className="lp-head">
          <b>{localize('com_ui_landing_deck_preview')}</b>
          <span>{localize('com_ui_landing_deck_slide')}</span>
        </div>
        <div className="lp-slide lp-slide-title lp-slide-main lp-a" style={at(1.9)}>
          <strong>{localize('com_ui_landing_deck_title')}</strong>
          <small>{localize('com_ui_landing_deck_sub')}</small>
        </div>
        <div className="lp-thumbs" aria-hidden="true">
          <div className="lp-slide lp-slide-title lp-a" style={at(2.2)} />
          <div className="lp-slide lp-a" style={at(2.35)}>
            <div className="lp-slide-hd" />
            <div className="lp-slide-rule" />
            <div className="lp-slide-line" />
            <div className="lp-slide-line" style={{ width: '60%' }} />
          </div>
          <div className="lp-slide lp-a" style={at(2.5)}>
            <div className="lp-slide-hd" />
            <div className="lp-slide-bars">
              <i style={{ height: '40%' }} />
              <i style={{ height: '65%' }} />
              <i style={{ height: '52%' }} />
              <i style={{ height: '90%' }} />
            </div>
          </div>
          <div className="lp-slide lp-a" style={at(2.65)}>
            <div className="lp-slide-hd" />
            <div className="lp-slide-rule" />
            <div className="lp-slide-line" />
            <div className="lp-slide-line" />
            <div className="lp-slide-line" style={{ width: '45%' }} />
          </div>
          <div className="lp-slide lp-a" style={at(2.8)}>
            <div className="lp-slide-hd" style={{ width: '35%' }} />
            <div className="lp-slide-rule" />
            <div className="lp-slide-line" style={{ width: '70%' }} />
          </div>
        </div>
        <span className="lp-btn lp-btn-sm lp-primary lp-download lp-a" style={at(3.3)}>
          ↓ {localize('com_ui_landing_deck_download')}
        </span>
      </div>
    </div>
  );
}

function DashboardScene({ active }: { active: boolean }) {
  const localize = useLocalize();
  const kpis: Array<[TranslationKeys, number, number, TranslationKeys]> = [
    ['com_ui_landing_dash_conversations', 148, 0, 'com_ui_landing_dash_trend'],
    ['com_ui_landing_dash_students', 63, 0, 'com_ui_landing_dash_enrolled'],
    ['com_ui_landing_dash_turns', 5.2, 1, 'com_ui_landing_dash_per'],
  ];
  return (
    <>
      <div className="lp-head">
        <b>{localize('com_ui_landing_dash_title')}</b>
        <span className="lp-chip">{localize('com_ui_landing_dash_window')}</span>
      </div>
      <div className="lp-dash">
        <div className="lp-kpis">
          {kpis.map(([label, value, decimals, note], i) => (
            <div key={label} className="lp-kpi lp-a" style={at(0.1 + i * 0.15)}>
              <span>{localize(label)}</span>
              <strong>
                <Count to={value} decimals={decimals} active={active} />
              </strong>
              <em>{localize(note)}</em>
            </div>
          ))}
        </div>
        <div className="lp-panels">
          <div className="lp-panel lp-a" style={at(0.5)}>
            <h3>{localize('com_ui_landing_dash_per_day')}</h3>
            <div className="lp-chart" aria-hidden="true">
              {CHART.map((height, i) => (
                <i
                  key={WEEKDAYS[i]}
                  className="lp-grow-y"
                  style={at(0.8 + i * 0.08, { '--h': `${height}%` })}
                />
              ))}
            </div>
            <div className="lp-days" aria-hidden="true">
              {WEEKDAYS.map((day) => (
                <span key={day}>{day}</span>
              ))}
            </div>
          </div>
          <div className="lp-panel lp-a" style={at(0.6)}>
            <h3>{localize('com_ui_landing_dash_topics')}</h3>
            {TOPICS.map(([topic, count], i) => (
              <div key={topic} className="lp-topic">
                <div>
                  <span>{localize(topic)}</span>
                  <b>{count}</b>
                </div>
                <div className="lp-track">
                  <i
                    className="lp-grow-x"
                    style={at(1.2 + i * 0.15, { '--w': `${(count / TOPICS[0][1]) * 100}%` })}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function AppScene() {
  const localize = useLocalize();
  const name = localize('com_ui_landing_builder_title');
  return (
    <div className="lp-deck">
      <div className="lp-deck-chat">
        <div className="lp-head">
          <span className="lp-head-left">
            <span className="lp-chip">
              <i />
              {name}
            </span>
            <span className="lp-model">{REPLIT}</span>
          </span>
        </div>
        <div className="lp-msgs">
          <div className="lp-msg-user lp-a" style={at(0.2)}>
            {localize('com_ui_landing_app_q')}
          </div>
          <BotMessage avatar="AB" name={name} delay={0.7} typing={1}>
            {localize('com_ui_landing_app_a')}
          </BotMessage>
        </div>
      </div>
      <div className="lp-deck-preview">
        <div className="lp-head">
          <b>{localize('com_ui_landing_app_preview')}</b>
          <span className="lp-live">{localize('com_ui_landing_app_live')}</span>
        </div>
        <div className="lp-mini lp-a" style={at(1.8)}>
          <h3>{localize('com_ui_landing_app_title')}</h3>
          <p>{localize('com_ui_landing_app_hint')}</p>
          <div className="lp-mini-field lp-a" style={at(2.1)}>
            <span>{localize('com_ui_landing_app_name')}</span>
            <div>{localize('com_ui_landing_app_name_value')}</div>
          </div>
          <div className="lp-mini-slots lp-a" style={at(2.35)}>
            <span>{localize('com_ui_landing_app_slot1')}</span>
            <span className="lp-mini-on">{localize('com_ui_landing_app_slot2')}</span>
            <span>{localize('com_ui_landing_app_slot3')}</span>
          </div>
          <span className="lp-btn lp-btn-sm lp-primary lp-a" style={at(2.6)}>
            {localize('com_ui_landing_app_join')}
          </span>
          <div className="lp-mini-going lp-a" style={at(3.1)}>
            <span>{localize('com_ui_landing_app_going', { 0: GOING.length })}</span>
            {GOING.map((initials, i) => (
              <i key={initials} className="lp-a" style={at(3.2 + i * 0.12)}>
                {initials}
              </i>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function EmbedScene() {
  const localize = useLocalize();
  return (
    <div className="lp-lms">
      <nav className="lp-lms-nav" aria-hidden="true">
        <b>{localize('com_ui_landing_embed_course')}</b>
        <div>{localize('com_ui_landing_lms_home')}</div>
        <div className="lp-lms-on">{localize('com_ui_landing_lms_modules')}</div>
        <div>{localize('com_ui_landing_lms_assignments')}</div>
        <div>{localize('com_ui_landing_lms_grades')}</div>
      </nav>
      <div className="lp-lms-page">
        <div className="lp-crumb">{localize('com_ui_landing_embed_crumb')}</div>
        <h3>{localize('com_ui_landing_embed_title')}</h3>
        <p>{localize('com_ui_landing_embed_body')}</p>
        <div className="lp-frame lp-a" style={at(0.2)}>
          <div className="lp-frame-head">
            <b>{localize('com_ui_landing_embed_name')}</b>
            <span>{localize('com_ui_landing_embed_powered')}</span>
          </div>
          <div className="lp-msgs">
            <BotMessage avatar="FA" delay={0.5}>
              {localize('com_ui_landing_embed_greet')}
            </BotMessage>
            <div className="lp-msg-user lp-a" style={at(1.2)}>
              {localize('com_ui_landing_embed_q')}
            </div>
            <BotMessage avatar="FA" delay={1.7} typing={1.1}>
              {localize('com_ui_landing_embed_a')}
            </BotMessage>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The hero's feature reel: one scene per feature, advancing every few seconds with a progress
 * bar on the active tab. Hover or focus pauses it; reduced motion shows each finished scene.
 */
export default function Reel() {
  const localize = useLocalize();
  const [active, setActive] = useState(0);
  const [playing, setPlaying] = useState<number | null>(0);
  const [previous, setPrevious] = useState<number | null>(null);
  const activeRef = useRef(0);
  const elapsed = useRef(0);
  const paused = useRef(false);
  const tabsRef = useRef<HTMLDivElement>(null);
  const fills = useRef<Array<HTMLSpanElement | null>>([]);

  const show = useCallback((next: number) => {
    const index = (next + TABS.length) % TABS.length;
    setPrevious(activeRef.current === index ? null : activeRef.current);
    activeRef.current = index;
    elapsed.current = 0;
    fills.current[index]?.style.setProperty('--p', '0');
    setActive(index);
    setPlaying(null);
    requestAnimationFrame(() => setPlaying(index));
    const bar = tabsRef.current;
    const tab = bar?.children[index] as HTMLElement | undefined;
    if (bar && tab && bar.scrollWidth > bar.clientWidth) {
      bar.scrollTo({ left: tab.offsetLeft - (bar.clientWidth - tab.offsetWidth) / 2 });
    }
  }, []);

  useEffect(() => {
    if (prefersStill()) {
      return;
    }
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(now - last, 100);
      last = now;
      if (!paused.current) {
        elapsed.current += dt;
        const progress = Math.min(1, elapsed.current / SCENE_MS);
        fills.current[activeRef.current]?.style.setProperty('--p', String(progress));
        if (progress >= 1) {
          show(activeRef.current + 1);
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [show]);

  const hold = (value: boolean) => () => {
    paused.current = value;
  };

  const plays = (i: number) => i === playing || i === previous;
  const scenes = [
    <TutorScene key="tutors" />,
    <DeckScene key="deck" />,
    <AppScene key="app" />,
    <DashboardScene key="dashboard" active={plays(3)} />,
    <EmbedScene key="embed" />,
  ];

  return (
    <div
      onMouseEnter={hold(true)}
      onMouseLeave={hold(false)}
      onFocus={hold(true)}
      onBlur={hold(false)}
    >
      <div className="lp-tabs" ref={tabsRef} aria-label={localize('com_ui_landing_reel_label')}>
        {TABS.map((tab, i) => (
          <button
            key={tab}
            type="button"
            className="lp-tab"
            aria-pressed={i === active}
            onClick={() => show(i)}
          >
            {localize(tab)}
            <span
              className="lp-fill"
              ref={(el) => {
                fills.current[i] = el;
              }}
            />
          </button>
        ))}
      </div>
      <div className="lp-window">
        <div className="lp-stage">
          {scenes.map((scene, i) => (
            <div
              key={TABS[i]}
              className={cn('lp-scene', i === active && 'lp-on', plays(i) && 'lp-play')}
              aria-hidden={i !== active}
            >
              {scene}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
