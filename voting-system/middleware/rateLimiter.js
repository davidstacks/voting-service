const rateLimit = require('express-rate-limit');

// General rate limiter
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Login rate limiter - strict
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many login attempts. Your access has been temporarily restricted. Try again in 15 minutes.',
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
});

// Vote rate limiter — STRICT: 2 attempts per minute per user session
const voteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 2,
  message: 'Voting rate limit exceeded. You can only submit 2 vote requests per minute. Please wait.',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `user-${req.session?.userId || req.ip}-${req.params.id || 'vote'}`,
  validate: { xForwardedForHeader: false, ip: false },
});

// Registration rate limiter
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  message: 'Too many registration attempts. Try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { generalLimiter, loginLimiter, voteLimiter, registerLimiter };
