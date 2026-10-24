const express = require('express');
const request = require('supertest');

jest.mock('@librechat/api', () => ({ limiterCache: jest.fn(() => undefined) }));

process.env.AGENT_API_USER_MAX = '2';
process.env.AGENT_API_KEY_MAX = '3';

const agentApiLimiters = require('./agentApiLimiter');

/** Stands in for agentKeyAuth: `?key=` and `?user=` become the agent key and the student. */
function makeApp() {
  const app = express();
  app.use((req, res, next) => {
    if (req.query.key) {
      req.agentKey = { id: req.query.key };
      req.user = { id: req.query.user };
    }
    next();
  });
  app.use(agentApiLimiters);
  app.get('/', (req, res) => res.json({ ok: true }));
  return app;
}

describe('agent API limiters', () => {
  it('caps each student under a key, with an OpenAI-shaped 429', async () => {
    const app = makeApp();
    await request(app).get('/?key=k1&user=sam').expect(200);
    await request(app).get('/?key=k1&user=sam').expect(200);
    const limited = await request(app).get('/?key=k1&user=sam').expect(429);
    expect(limited.headers['retry-after']).toBe('60');
    expect(limited.body.error.code).toBe('rate_limit_exceeded');
  });

  it('caps the whole key across students', async () => {
    const app = makeApp();
    await request(app).get('/?key=k2&user=a').expect(200);
    await request(app).get('/?key=k2&user=b').expect(200);
    await request(app).get('/?key=k2&user=c').expect(200);
    const limited = await request(app).get('/?key=k2&user=d');
    expect(limited.status).toBe(429);
  });

  it('never limits requests without an agent key', async () => {
    const app = makeApp();
    const statuses = [];
    for (let index = 0; index < 5; index++) {
      statuses.push((await request(app).get('/')).status);
    }
    expect(statuses).toEqual([200, 200, 200, 200, 200]);
  });
});
