import { pino } from 'pino';

/** Structured JSON logs; sensitive fields are redacted (docs/10 §4). */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
  redact: {
    paths: ['password', '*.password', 'refreshToken', '*.refreshToken', 'accessToken', '*.accessToken', 'req.headers.authorization', 'req.headers.cookie', 'otp', '*.otp', 'code', '*.code'],
    censor: '***',
  },
});
