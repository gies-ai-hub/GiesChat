---
name: gieschat-agent-api
description: Connect a course website's backend to a GiesChat class agent through the GiesChat Agent API (OpenAI-compatible). Use when adding a GiesChat chatbot to a site, passing Illinois sign-in tokens to it, continuing student conversations, or fixing its 401, 403, 404 or 429 errors.
---

# GiesChat Agent API

GiesChat (https://gieschat.azurewebsites.net) runs class agents for the Gies College of
Business at the University of Illinois. This site's **server** calls one agent on behalf of
each student who signed in with Illinois on this site. The agent's instructions and
documents live in GiesChat; this site only sends the student's messages and shows replies.

- Agent id: `agent_YOUR_AGENT_ID`
- Base URL: `https://gieschat.azurewebsites.net/api/agents/v1`
- Full guide: https://gieschat.azurewebsites.net/docs/use-api.html

If the agent id above is a placeholder, ask the professor for the real one. It starts with
`agent_` and shows in the Agent dashboard's address bar (`?agent=…`) when the agent is
selected. Use the same id everywhere this skill shows one.

## What to ask the professor for

1. The **API key** (starts with `sk-`). They create it in the Agent dashboard: hover the
   agent, choose the key icon (API access), then New key. It is shown once.
2. The **Application (client) ID** of this site's Microsoft Entra app. The key only accepts
   student tokens issued to that app, so it must be the app this site signs in with.

## Rules

- Call the API from the server only. Read the key from an environment variable
  (`GIESCHAT_API_KEY`). Never put it in browser code, the repo, logs or error messages.
- Every request sends two headers:
  - `Authorization: Bearer <GIESCHAT_API_KEY>`
  - `X-GiesChat-User-Token: <the signed-in student's Illinois ID token>`
- The student token is the **ID token** from this site's own Illinois sign-in (Microsoft
  Entra, v2.0 endpoint, scopes `openid profile email`). `profile` is required: GiesChat
  matches the student by the `oid` claim. Access tokens do not work.
- ID tokens expire after about an hour. Refresh the sign-in (MSAL and most OIDC libraries do
  this silently) and send the new token. Never send one student's token for another.
- Send only the student's new message. GiesChat keeps the history and uses only the last
  `user` message; `system` and `assistant` messages are ignored, so do not try to steer the
  agent with a system prompt. The professor edits instructions in GiesChat.
- MCP and connected tools (Canvas, Outlook) are off for API calls.

## Python (OpenAI SDK, Responses API)

```python
import os
from openai import OpenAI

client = OpenAI(
    base_url="https://gieschat.azurewebsites.net/api/agents/v1",
    api_key=os.environ["GIESCHAT_API_KEY"],
)

def ask(message, student_id_token, previous_response_id=None):
    response = client.responses.create(
        model="agent_YOUR_AGENT_ID",
        input=message,
        previous_response_id=previous_response_id,
        extra_headers={"X-GiesChat-User-Token": student_id_token},
    )
    # Store response.id with the student's session to continue the conversation.
    return response.output_text, response.id
```

## Node.js (openai package, Responses API)

```js
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'https://gieschat.azurewebsites.net/api/agents/v1',
  apiKey: process.env.GIESCHAT_API_KEY,
});

export async function ask(message, studentIdToken, previousResponseId) {
  const response = await client.responses.create(
    {
      model: 'agent_YOUR_AGENT_ID',
      input: message,
      ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
    },
    { headers: { 'X-GiesChat-User-Token': studentIdToken } },
  );
  return { text: response.output_text, id: response.id };
}
```

## Chat Completions instead

`POST /chat/completions` with `{"messages": [{"role": "user", "content": "..."}]}` also
works, with `"stream": true` for server-sent events. The reply's
`X-GiesChat-Conversation-Id` header (and `conversation_id` in non-streamed bodies) is the
conversation id; send it back as `conversation_id` to continue.

## Conversations

- Responses API: pass `previous_response_id` = the last `response.id`.
- Chat Completions: pass `conversation_id`.
- Keep that id per student on the server. A key can only continue conversations it
  started, and only for the same student.
- Students also see these chats in their own GiesChat sidebar.

## Models

Leave `model` as the agent id to use the model the professor picked. To use another one,
send its id; `GET /models` lists the allowed ones. Another agent's id is refused.

## Limits

300 requests a minute per key, and 20 a minute per student per key. Over the limit the
API answers `429` with `Retry-After` (seconds). Show the student a short "try again in a
minute" message rather than retrying in a loop.

## Errors

Errors use the OpenAI shape `{"error": {"message", "type", "code"}}`.

| Status | Code | Fix |
|---|---|---|
| 401 | `invalid_user_token` | Token missing, expired, not an ID token, or issued to a different Entra app than the key's. Decode it: `aud` must be the key's app id, `iss` must end in `/v2.0`, and it must have `oid`. |
| 401 | `invalid_api_key` | The key's agent was deleted. Ask the professor for a new key. |
| 403 | `key_wrong_agent` | `model` names a different agent. Use this agent's id. |
| 404 | `model_not_found` | That model is not offered. Pick one from `GET /models`. |
| 404 | `conversation_not_found` | Wrong id, another key started it, or another student's. Start a new conversation. |
| 429 | `rate_limit_exceeded` | Wait `Retry-After` seconds. |

A revoked or unknown key is also refused with a 401. If the professor revoked it, they
must create a new one.

## Before you call it done

- The key is only in server-side environment settings, and `.env` files are gitignored.
- A real student sign-in reaches the agent and gets a reply.
- A second message continues the same conversation (the agent remembers the first).
- An expired or missing token shows the student a "please sign in again" message.
