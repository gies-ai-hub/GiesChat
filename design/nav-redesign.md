# GiesChat — Left navigation redesign proposal

_Basis: dogfood findings NAV-1 – NAV-7. Status: proposal / for discussion._

A styled before/after mockup lives alongside this file at
[`nav-redesign.html`](./nav-redesign.html) — view it rendered via
[htmlpreview](https://htmlpreview.github.io/?https://github.com/gies-ai-experiments/GiesChat/blob/design/nav-redesign-proposal/design/nav-redesign.html).

## The problem

Today ten look-alike icons in the left rail behave **three different ways**, and the same
feature hides in up to four places.

- **Panel switchers** (Chat History, Brainstorm, Agent Builder, Skills, Attach Files, MCP Settings) — swap the side panel
- **Menu launchers** (More "…", Account avatar) — open a popup, not a panel
- **Direct actions** (New chat → navigates; Collapse → hides the panel)

Only one divider exists in the whole rail, so nothing signals which icon does which.

## Before → After (rail)

```
   TODAY (10 icons, 3 behaviors, 1 divider,      PROPOSED (grouped, labeled, 1 behavior/zone)
   2 hidden menus)
  ┌──────────────┐                              ┌──────────────────────────┐
  │ ⊟ Collapse   │  action                      │ ⊟  Collapse        ⌘⇧S   │
  │ ✎ New chat   │  action                      │ ✎  New chat              │  ← primary action
  │ ⋯ More       │  MENU → Marketplace, Plugins ├──── YOUR WORKSPACE ──────┤
  │──────────────│  (only divider)              │ 💬 Chats                 │  ← history+archived+projects
  │ 💬 Chat Hist │  panel                       │ 👥 Rooms                 │  ← was "Brainstorm"
  │ 💡 Brainstorm│  panel (actually ROOMS)      │ 📎 Files                 │  ← attach+my files+manage
  │ 🤖 Agent Bld │  panel (cramped 200px form)  ├──── BUILD & EXTEND ──────┤
  │ ⚡ Skills    │  panel                       │ 🤖 Agents                │  ← builder + marketplace
  │ 📎 Att Files │  panel                       │ 🛠 Tools                 │  ← MCP + skills + plugins
  │ 🧩 MCP       │  panel                       ├──────────────────────────┤
  │ 🧑 Account   │  MENU                        │ 🧑 Account            ▾  │  ← settings · help · log out
  └──────────────┘                              └──────────────────────────┘
```

## One home per concept

The same capability is reachable today from several unrelated places. Fold each into a single
destination, usually with tabs inside.

| Concept | Today (scattered) | Proposed (one home) |
|---|---|---|
| **Agents** | Agent Builder (rail) + Agent Marketplace (⋯ menu) | **Agents** → tabs: `Browse` · `Mine` · `+ Create` |
| **Tools** | MCP + Skills (rail) + Plugins (⋯ menu) + composer dropdown | **Tools** → tabs: `Connections (MCP)` · `Skills` · `Plugins` |
| **Files** | Attach Files (rail) + My Files (account) + Manage Files (in-panel) | **Files** → one list, one "Manage" |
| **Conversations** | Chat History (rail) + Archived (account) + Projects (breadcrumb) | **Chats** → Projects = scope, Archived = toggle |

Net: **~10 icons + 2 popup menus → 6 destinations in 3 labeled groups + Account.**

## Three supporting fixes

- **Rename Brainstorm → Rooms.** It already opens shared, multi-user conversations (list items
  show member counts). Keep "Brainstorm" as a room template, not the nav label.
- **One panel header.** Every panel invents its own header today (title+search+add / filter-only /
  breadcrumb / "Create New…" dropdown). Standardize: **title · search · primary "+"**, applied to all six.
- **Builder leaves the rail.** A full agent-authoring form doesn't fit a 200px column. "+ Create"
  opens in the main content area (or a wide modal); the panel just lists agents.

## Tradeoffs & open questions

- **Do MCP, Skills & Plugins really share one "Tools" home?** If they're distinct products, keep
  them separate — but at minimum lift Plugins out of the hidden "…" menu onto the rail.
- **Icon rail vs. full labeled sidebar?** Kept the compact rail to preserve chat width; labels
  show on expand/hover. An expandable labeled rail is the safer default if discoverability for a
  non-technical audience matters more than width.
- **Is upstream (LibreChat) itself reworking its SidePanel?** Worth checking before we fork the nav
  — align with their direction rather than around it.

## Sequencing (see the upstream-drift review issue)

Because these files sit in the upstream-collision set, split the work:

- **Do now (low drift):** Brainstorm → Rooms rename; lift Plugins out of the "…" menu; standardize the panel header (additive component).
- **Defer (high drift):** structural rail regrouping; merging Agents and Tools; moving the builder to the main area — gated on a running upstream-sync cadence and a config-driven or upstream path.

---
_Wireframes are indicative, not final visual design._
