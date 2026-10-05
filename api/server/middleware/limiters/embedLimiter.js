const rateLimit = require('express-rate-limit');
const { limiterCache, removePorts } = require('@librechat/api');

/**
 * Every iframe load starts a session, and a whole class can share one campus IP, so this
 * sits far above the login limiter's 7 and logs no violation (a crowded lecture must never
 * add up to a ban). It only bounds how fast one address can mint anonymous guests.
 * ponytail: per-IP only; key on the embed key too if one link ever needs its own ceiling.
 */
const { EMBED_WINDOW = 5, EMBED_MAX = 100 } = process.env;
const windowMs = EMBED_WINDOW * 60 * 1000;

const embedLimiter = rateLimit({
  windowMs,
  max: EMBED_MAX,
  keyGenerator: removePorts,
  store: limiterCache('embed_limiter'),
  handler: (req, res) =>
    res.status(429).json({
      message: `Too many chat sessions started from this network, please try again in ${EMBED_WINDOW} minutes.`,
    }),
});

module.exports = embedLimiter;
