# Deck agent configuration

The PowerPoint deck builder is two LibreChat agents plus one skill. The MCP
server (`infra/pptx-mcp/`) is unchanged by this — it stays a dumb tool server.

| File | Goes where |
|---|---|
| `orchestrator.md` | Instructions of the user-facing **Deck Orchestrator** agent |
| `slide-writer.md` | Instructions of the **Slide Writer** sub-agent |
| `gies-deck-playbook/SKILL.md` | Imported through the Skills UI |

These files are the source of truth. The agents themselves live in MongoDB, so
edits here must be pasted back into the agent builder to take effect.

## Why two agents

`gies_state.py` keys every presentation by the authenticated user and keeps one
`_current` pointer per user, in RAM, on a single container instance. Two agents
calling the MCP concurrently for the same user would race on that pointer and
on slide append order.

Explicit sub-agents do not inherit the parent's MCP servers
(`packages/api/src/agents/run.ts:958`), so a Slide Writer *cannot* reach the
PowerPoint tools. The orchestrator is the only writer by construction, not by
convention.

## Setup

Already done on the local dev database (2026-07-26):

| Thing | Id |
|---|---|
| `gies-deck-playbook` skill | `6a666c79228969b138827f67` |
| Slide Writer agent | `agent_SviS4l_kN4j-t4f-vVnQX` |
| Deck Builder agent | `agent_2FUm9nHL2dJSDSKnvkFey` |

Repeat these steps on any other environment:

1. **Import the skill.** Skills UI → import `gies-deck-playbook/SKILL.md`.
2. **Create the Slide Writer agent.**
   - Instructions: contents of `slide-writer.md`
   - Model: `gpt-5.4-mini`
   - **No tools, no MCP servers.** This is load-bearing, not an optimization.
3. **Create the Deck Orchestrator agent.**
   - Instructions: contents of `orchestrator.md`
   - Model: `gpt-5.4`
   - Tools: the `powerpoint` MCP, plus the `memory` marker
   - Memory scope: `agent`
   - Skills: enabled, scoped to `gies-deck-playbook`
   - Subagents: enabled, `allowSelf: false`, agent_ids `[<slide-writer id>]`

`subagents` and `skills` are already in `defaultAgentCapabilities` and
`librechat.yaml` never overrides `endpoints.agents.capabilities`, so no
capability config is needed.

## Memory

The `memory:` block in `librechat.yaml` has **no `agent:` sub-block**, on
purpose. Adding one sets `memory.agent.enabled` and makes
`api/server/controllers/agents/client.js:1736` fire a second full agentic run
on every turn of *every* agent for *every* user, blocking each response for up
to 3s. Memory here is inline instead: the orchestrator carries `set_memory` /
`delete_memory` itself, scoped to its own partition.

Trade-off: nothing is learned passively. A user must say "remember I want
minimal decks" once.

## Verifying a change

The MCP is untouched, so its suite must still pass unchanged:

```
cd infra/pptx-mcp && PPTX_MCP_KEY=testkey ./.venv/bin/python -m pytest tests/ -q
```

Everything else is prose, so check it by building decks:

1. **5 slides** — no `subagent` calls in the transcript at all.
2. **14 slides** — 3 `subagent` calls in one message; final slide order matches
   the plan, not the order the writers finished.
3. **Induced failure** — a writer returns prose; the deck still ships with that
   section written by the orchestrator.
4. **Memory scope** — a turn on another agent (Course Tutors) shows no memory
   run and no added latency.

Every case also confirms no download link appears before the user approves.

## After changing these prompts

The Deck Builder and Slide Writer live in MongoDB. Editing the files in this
directory changes nothing until the prompt is pasted into the agent itself.

Verify the preview flow end to end:

1. Ask for a 6-slide deck; answer the question card.
2. The reply should be one artifact block plus one line — **no outline**. The
   slide panel opens on the right showing 6 slides.
3. Say "change slide 3 to ...". The reply re-posts a preview whose URL differs
   from the first, and the panel gains a second version.
4. Say "drop slide 5". The panel comes back with 5 slides.
5. Approve. Only now does a download link appear.
