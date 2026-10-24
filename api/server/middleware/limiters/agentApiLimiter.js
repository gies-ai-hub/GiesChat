const rateLimit = require('express-rate-limit');
const { limiterCache } = require('@librechat/api');

/**
 * Agent API keys only (`skip` lets JWT and upstream traffic through). Each student gets
 * their own ceiling under the key's overall one, so one heavy user cannot spend a whole
 * class's budget.
 */
const { AGENT_API_WINDOW = 1, AGENT_API_USER_MAX = 20, AGENT_API_KEY_MAX = 300 } = process.env;
const windowMs = AGENT_API_WINDOW * 60 * 1000;

const handler = (req, res) => {
  res.setHeader('Retry-After', String(Math.ceil(windowMs / 1000)));
  res.status(429).json({
    error: {
      message: `Too many requests for this key. Try again in ${AGENT_API_WINDOW} minute(s).`,
      type: 'rate_limit_error',
      code: 'rate_limit_exceeded',
    },
  });
};

const skip = (req) => req.agentKey == null;

const perKey = rateLimit({
  windowMs,
  max: AGENT_API_KEY_MAX,
  skip,
  keyGenerator: (req) => req.agentKey.id,
  store: limiterCache('agent_api_key_limiter'),
  handler,
});

const perStudent = rateLimit({
  windowMs,
  max: AGENT_API_USER_MAX,
  skip,
  keyGenerator: (req) => `${req.agentKey.id}:${req.user.id}`,
  store: limiterCache('agent_api_user_limiter'),
  handler,
});

module.exports = [perKey, perStudent];
