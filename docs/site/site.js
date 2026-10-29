// Builds the shared header, sidebar, search and prev/next around each page's <main>.
// ponytail: plain script, no fetch, so the site also works opened straight from disk.
const SECTIONS = [
  ['Using GiesChat', [
    ['use-start.html', 'Getting started', 'sign in sso welcome luna model tour chat'],
    ['use-agents.html', 'Building a class agent', 'agent dashboard admin create agent instructions documents websites scrape model test support contact course'],
    ['use-collaborators.html', 'Collaborators, drafts & co-admins', 'invite email roles draft post production test link co-admin'],
    ['use-embed.html', 'Embedding an agent', 'embed iframe canvas snippet public illinois guest revoke greeting theme'],
    ['use-api.html', 'Agent API', 'api key openai chat completions responses course site entra id token developer integrate'],
    ['use-tools.html', 'Tools', 'mcp canvas outlook ms365 deck builder powerpoint pptx app builder replit tutors career prep'],
    ['use-issues.html', 'Reporting an issue', 'bug report github issue feedback'],
  ]],
  ['How it works', [
    ['dev-architecture.html', 'Architecture', 'workspace monorepo api client packages data-provider data-schemas infra layout'],
    ['dev-chat-flow.html', 'Life of a chat message', 'sse stream request controller agents run langgraph generation job resumable'],
    ['dev-auth.html', 'Auth & permissions', 'openid entra sso jwt refresh session roles acl grants guest embed capability'],
    ['dev-data.html', 'Data model', 'mongodb mongoose schema collections meilisearch rag redis azure blob'],
    ['dev-config.html', 'Configuration', 'librechat.yaml env endpoints models model specs mcp servers interface flags'],
    ['dev-features.html', 'Gies features → code', 'agent dashboard embed drafts collaborators websites crawl luna model test support contact rooms mindforum tour report issue'],
    ['dev-deploy.html', 'Deploy', 'github actions azure web app acr docker staging slot'],
  ]],
];
const PAGES = SECTIONS.flatMap(([, pages]) => pages);

const root = document.documentElement;
try { const t = localStorage.getItem('docs-theme'); if (t) root.dataset.theme = t; } catch {}

const here = location.pathname.split('/').pop() || 'index.html';
const main = document.querySelector('main');

const header = document.createElement('header');
header.className = 'top';
header.innerHTML = `
  <button id="menu" aria-label="Menu">☰</button>
  <a class="logo" href="index.html">Gies<span>Chat</span> Docs</a>
  <div class="sp"></div>
  <input id="q" type="search" placeholder="Search docs" aria-label="Search docs">
  <button id="theme" aria-label="Toggle dark mode">◐</button>`;

const nav = document.createElement('nav');
nav.className = 'side';
nav.innerHTML = SECTIONS.map(([title, pages]) =>
  `<h4>${title}</h4>` + pages.map(([href, name, kw]) =>
    `<a href="${href}" data-kw="${(name + ' ' + kw).toLowerCase()}"${href === here ? ' class="on"' : ''}>${name}</a>`).join('')
).join('');

const shell = document.createElement('div');
shell.className = 'shell';
document.body.prepend(header, shell);
shell.append(nav, main);

const i = PAGES.findIndex(([href]) => href === here);
if (i >= 0) {
  const prev = PAGES[i - 1], next = PAGES[i + 1];
  const pager = document.createElement('div');
  pager.className = 'pager';
  pager.innerHTML = `<span>${prev ? `<a href="${prev[0]}">← ${prev[1]}</a>` : ''}</span><span>${next ? `<a href="${next[0]}">${next[1]} →</a>` : ''}</span>`;
  main.append(pager);
}

document.getElementById('q').addEventListener('input', (e) => {
  const q = e.target.value.trim().toLowerCase();
  nav.querySelectorAll('a').forEach((a) => { a.hidden = q && !a.dataset.kw.includes(q); });
  if (q) nav.classList.add('open');
});
document.getElementById('menu').onclick = () => nav.classList.toggle('open');
document.getElementById('theme').onclick = () => {
  const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = dark ? 'light' : 'dark';
  try { localStorage.setItem('docs-theme', root.dataset.theme); } catch {}
};

// Diagrams sit on a white card in both themes, so mermaid always renders its light theme.
if (window.mermaid) mermaid.initialize({ startOnLoad: true, theme: 'neutral' });
