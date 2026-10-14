import { Link } from 'react-router-dom';
import { Code, LogIn, Briefcase, Presentation, GraduationCap, MessageSquare } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { CSSProperties } from 'react';
import type { TranslationKeys } from '~/hooks';
import { BackgroundToggle } from '~/components/ui';
import { useLocalize } from '~/hooks';
import bifNight from './bif-night.jpg';
import Faculty from './Faculty';
import gies from './gies.jpg';
import bif from './bif.jpg';
import Reel from './Reel';
import './landing.css';

/** Served by the API from `docs/site` (see `api/server/index.js`). */
const DOCS = '/docs/';

/** The student tools that sit beside the course-tutor card. */
const TOOLS: Array<{
  icon: LucideIcon;
  title: TranslationKeys;
  body: TranslationKeys;
  doc: string;
}> = [
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
    icon: MessageSquare,
    title: 'com_ui_landing_chat_title',
    body: 'com_ui_landing_chat_body',
    doc: 'use-start.html',
  },
];

/** Subjects, not course numbers: the seven tutors in `config/gies-tutors/tutors.json`. */
const SUBJECTS: TranslationKeys[] = [
  'com_ui_landing_subject_finance',
  'com_ui_landing_subject_accounting',
  'com_ui_landing_subject_economics',
  'com_ui_landing_subject_law',
  'com_ui_landing_subject_more',
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
      ['com_ui_landing_students_tag', '#features'],
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
          <a href="#features">{localize('com_ui_landing_students_tag')}</a>
          <a href="#faculty">{localize('com_ui_landing_nav_faculty')}</a>
          <a href={`${DOCS}index.html`}>{localize('com_ui_landing_nav_docs')}</a>
        </div>
        <div className="lp-nav-end">
          <BackgroundToggle icon />
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

      <section
        className="lp-section lp-soft"
        id="features"
        style={{ '--lp-section-photo': `url(${gies})` } as CSSProperties}
      >
        <div className="lp-section-head">
          <div className="lp-tag">{localize('com_ui_landing_students_tag')}</div>
          <h2>{localize('com_ui_landing_students_title')}</h2>
          <p>{localize('com_ui_landing_students_body')}</p>
        </div>
        <div className="lp-bento">
          <a href={`${DOCS}use-tools.html`} className="lp-card lp-lead lp-focus">
            <span className="lp-icon">
              <GraduationCap className="size-[18px]" aria-hidden="true" />
            </span>
            <h3>{localize('com_ui_landing_tutors_title')}</h3>
            <p>{localize('com_ui_landing_tutors_body')}</p>
            <div className="lp-mini" aria-hidden="true">
              <div className="lp-msg-user">{localize('com_ui_landing_tutors_q')}</div>
              <div className="lp-who">{localize('com_ui_landing_tutors_name')}</div>
              <div>{localize('com_ui_landing_tutors_a')}</div>
              <div className="lp-msg-user">{localize('com_ui_landing_tutors_q2')}</div>
            </div>
            <div className="lp-pills">
              {SUBJECTS.map((subject) => (
                <span key={subject}>{localize(subject)}</span>
              ))}
            </div>
            <span className="lp-more">{localize('com_ui_landing_learn_more')} →</span>
          </a>
          {TOOLS.map(({ icon: Icon, title, body, doc }) => (
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

      <section
        className="lp-section lp-band"
        id="faculty"
        style={{ '--lp-section-photo': `url(${bifNight})` } as CSSProperties}
      >
        <div className="lp-section-head lp-start">
          <div className="lp-tag">{localize('com_ui_landing_nav_faculty')}</div>
          <h2>{localize('com_ui_landing_tour_title')}</h2>
          <p>{localize('com_ui_landing_tour_body')}</p>
        </div>
        <Faculty>
          <SignIn label={signIn} />
          <a href={`${DOCS}use-agents.html`} className="lp-btn lp-ghost">
            {localize('com_ui_landing_agents_cta')} →
          </a>
        </Faculty>
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
        <div className="lp-cta" style={{ '--lp-cta-photo': `url(${gies})` } as CSSProperties}>
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
