import { Link } from 'react-router-dom';
import {
  Bot,
  Code,
  LogIn,
  Users,
  AppWindow,
  BarChart3,
  Briefcase,
  Presentation,
  GraduationCap,
  MessageSquare,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { CSSProperties } from 'react';
import type { TranslationKeys } from '~/hooks';
import { BackgroundToggle } from '~/components/ui';
import { useLocalize } from '~/hooks';
import bif from './bif.jpg';
import Reel from './Reel';
import './landing.css';

/** Served by the API from `docs/site` (see `api/server/index.js`). */
const DOCS = '/docs/';

const FEATURES: Array<{
  icon: LucideIcon;
  title: TranslationKeys;
  body: TranslationKeys;
  doc: string;
}> = [
  {
    icon: MessageSquare,
    title: 'com_ui_landing_models_title',
    body: 'com_ui_landing_models_body',
    doc: 'use-start.html',
  },
  {
    icon: GraduationCap,
    title: 'com_ui_landing_tab_tutors',
    body: 'com_ui_landing_tutors_body',
    doc: 'use-tools.html',
  },
  {
    icon: Briefcase,
    title: 'com_ui_landing_career_title',
    body: 'com_ui_landing_career_body',
    doc: 'use-tools.html',
  },
  {
    icon: Presentation,
    title: 'com_ui_landing_tab_deck',
    body: 'com_ui_landing_deck_body',
    doc: 'use-tools.html',
  },
  {
    icon: Code,
    title: 'com_ui_landing_builder_title',
    body: 'com_ui_landing_builder_body',
    doc: 'use-tools.html',
  },
  {
    icon: Bot,
    title: 'com_ui_landing_agents_title',
    body: 'com_ui_landing_agents_body',
    doc: 'use-agents.html',
  },
  {
    icon: BarChart3,
    title: 'com_ui_landing_tab_dashboard',
    body: 'com_ui_landing_dashboard_body',
    doc: 'use-agents.html',
  },
  {
    icon: AppWindow,
    title: 'com_ui_landing_tab_embed',
    body: 'com_ui_landing_embed_card',
    doc: 'use-embed.html',
  },
  {
    icon: Users,
    title: 'com_ui_landing_team_title',
    body: 'com_ui_landing_team_body',
    doc: 'use-collaborators.html',
  },
];

const AUDIENCES: Array<{
  tag: TranslationKeys;
  title: TranslationKeys;
  points: TranslationKeys[];
  faculty: boolean;
}> = [
  {
    tag: 'com_ui_landing_students_tag',
    title: 'com_ui_landing_students_title',
    points: ['com_ui_landing_students_1', 'com_ui_landing_students_2', 'com_ui_landing_students_3'],
    faculty: false,
  },
  {
    tag: 'com_ui_landing_nav_faculty',
    title: 'com_ui_landing_faculty_title',
    points: ['com_ui_landing_faculty_1', 'com_ui_landing_faculty_2', 'com_ui_landing_faculty_3'],
    faculty: true,
  },
];

const FACTS: Array<[string, TranslationKeys]> = [
  ['4', 'com_ui_landing_fact_models'],
  ['7', 'com_ui_landing_fact_tutors'],
  ['1', 'com_ui_landing_fact_signin'],
];

const FAQS: Array<[TranslationKeys, TranslationKeys]> = [
  ['com_ui_landing_faq1_q', 'com_ui_landing_faq1_a'],
  ['com_ui_landing_faq2_q', 'com_ui_landing_faq2_a'],
  ['com_ui_landing_faq3_q', 'com_ui_landing_faq3_a'],
  ['com_ui_landing_faq4_q', 'com_ui_landing_faq4_a'],
  ['com_ui_landing_faq5_q', 'com_ui_landing_faq5_a'],
];

const FOOTER: Array<{ title: TranslationKeys; links: Array<[TranslationKeys, string]> }> = [
  {
    title: 'com_ui_landing_footer_product',
    links: [
      ['com_ui_landing_nav_features', '#features'],
      ['com_ui_landing_tab_tutors', `${DOCS}use-tools.html`],
      ['com_ui_landing_tab_dashboard', `${DOCS}use-agents.html`],
    ],
  },
  {
    title: 'com_ui_landing_nav_docs',
    links: [
      ['com_ui_landing_getting_started', `${DOCS}use-start.html`],
      ['com_ui_landing_agents_title', `${DOCS}use-agents.html`],
      ['com_ui_landing_footer_embedding', `${DOCS}use-embed.html`],
    ],
  },
  {
    title: 'com_ui_landing_footer_help',
    links: [
      ['com_ui_landing_footer_report', `${DOCS}use-issues.html`],
      ['com_ui_landing_footer_how', `${DOCS}index.html`],
    ],
  },
];

function SignIn({ large = false, label }: { large?: boolean; label: string }) {
  return (
    <Link to="/login" className={large ? 'lp-btn lp-btn-lg lp-primary' : 'lp-btn lp-primary'}>
      {large && <LogIn className="size-4" aria-hidden="true" />}
      {label}
    </Link>
  );
}

/** Public front page for signed-out visitors (`/welcome`); sign-in goes through `/login`. */
export default function Welcome() {
  const localize = useLocalize();
  const signIn = localize('com_ui_landing_cta');
  const brand = (
    <a href="#top" className="lp-brand lp-focus">
      <img src="assets/logo.svg" alt="" aria-hidden="true" />
      {localize('com_ui_landing_wordmark')}
    </a>
  );
  return (
    <div className="lp" id="top">
      <nav className="lp-nav" aria-label={localize('com_ui_landing_wordmark')}>
        {brand}
        <div className="lp-links">
          <a href="#features">{localize('com_ui_landing_nav_features')}</a>
          <a href="#faculty">{localize('com_ui_landing_nav_faculty')}</a>
          <a href={`${DOCS}index.html`}>{localize('com_ui_landing_nav_docs')}</a>
        </div>
        <div className="lp-nav-end">
          <BackgroundToggle compact />
          <SignIn label={localize('com_ui_landing_sign_in')} />
        </div>
      </nav>

      <header className="lp-hero" style={{ '--lp-photo': `url(${bif})` } as CSSProperties}>
        <span className="lp-photo-credit">{localize('com_ui_landing_bif_label')}</span>
        <span className="lp-news">
          <b>{localize('com_ui_landing_news_tag')}</b>
          {localize('com_ui_landing_news')}
        </span>
        <h1 className="lp-title">
          {localize('com_ui_landing_title_lead')}{' '}
          <span>{localize('com_ui_landing_title_accent')}</span>{' '}
          {localize('com_ui_landing_title_tail')}
        </h1>
        <p className="lp-sub">{localize('com_ui_landing_subline')}</p>
        <div className="lp-ctas">
          <SignIn large label={signIn} />
          <a href={`${DOCS}index.html`} className="lp-btn lp-btn-lg lp-ghost">
            {localize('com_ui_landing_read_docs')}
          </a>
        </div>
        <p className="lp-fine">{localize('com_ui_landing_audience')}</p>
        <Reel />
      </header>

      <section className="lp-section" id="features">
        <div className="lp-section-head">
          <h2>{localize('com_ui_landing_features_title')}</h2>
          <p>{localize('com_ui_landing_features_body')}</p>
        </div>
        <div className="lp-grid">
          {FEATURES.map(({ icon: Icon, title, body, doc }) => (
            <a key={body} href={`${DOCS}${doc}`} className="lp-card lp-focus">
              <span className="lp-icon">
                <Icon className="size-[18px]" aria-hidden="true" />
              </span>
              <h3>{localize(title)}</h3>
              <p>{localize(body)}</p>
              <span className="lp-more">{localize('com_ui_landing_learn_more')} →</span>
            </a>
          ))}
        </div>
      </section>

      <section className="lp-section lp-alt" id="faculty">
        <div className="lp-section-head">
          <h2>{localize('com_ui_landing_audience_title')}</h2>
          <p>{localize('com_ui_landing_audience_body')}</p>
        </div>
        <div className="lp-split">
          {AUDIENCES.map(({ tag, title, points, faculty }) => (
            <div key={tag} className="lp-audience">
              <div className="lp-audience-tag">{localize(tag)}</div>
              <h3>{localize(title)}</h3>
              <ul>
                {points.map((point) => (
                  <li key={point}>{localize(point)}</li>
                ))}
              </ul>
              {faculty ? (
                <a href={`${DOCS}use-agents.html`} className="lp-btn lp-outline">
                  {localize('com_ui_landing_agents_cta')} →
                </a>
              ) : (
                <SignIn label={signIn} />
              )}
            </div>
          ))}
        </div>
        <div className="lp-facts">
          {FACTS.map(([value, label]) => (
            <div key={label} className="lp-fact">
              <strong>{value}</strong>
              <span>{localize(label)}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="lp-section">
        <div className="lp-section-head">
          <h2>{localize('com_ui_landing_faq_title')}</h2>
        </div>
        <div className="lp-faq">
          {FAQS.map(([question, answer]) => (
            <details key={question}>
              <summary>{localize(question)}</summary>
              <p>{localize(answer)}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="lp-section" style={{ paddingTop: 0 }}>
        <div className="lp-cta">
          <h2>{localize('com_ui_landing_outro_title')}</h2>
          <p>{localize('com_ui_landing_outro_body')}</p>
          <div className="lp-ctas">
            <SignIn large label={signIn} />
            <a href={`${DOCS}use-start.html`} className="lp-btn lp-btn-lg lp-ghost">
              {localize('com_ui_landing_getting_started')}
            </a>
          </div>
        </div>
      </section>

      <footer className="lp-foot">
        <div>
          {brand}
          <p className="lp-foot-note">
            {localize('com_ui_landing_footer_college')}
            <br />
            {localize('com_ui_landing_footer_university')}
            <br />
            {localize('com_ui_landing_footer_lab')}
          </p>
        </div>
        {FOOTER.map(({ title, links }) => (
          <div key={title}>
            <h2>{localize(title)}</h2>
            {links.map(([label, href]) => (
              <a key={label} href={href}>
                {localize(label)}
              </a>
            ))}
          </div>
        ))}
      </footer>
    </div>
  );
}
