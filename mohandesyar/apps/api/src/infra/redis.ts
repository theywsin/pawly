import { Redis } from 'ioredis';

export function createRedis(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: 3, lazyConnect: false });
}

/** Fixed-window rate limiter: returns false when `key` exceeded `limit` hits within `windowSec`. */
export async function rateLimit(redis: Redis, key: string, limit: number, windowSec: number): Promise<boolean> {
  const k = `rl:${key}`;
  const n = await redis.incr(k);
  if (n === 1) await redis.expire(k, windowSec);
  return n <= limit;
}

export type { Redis };
