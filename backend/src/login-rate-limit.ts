export interface LoginLimiterOptions {
  maxAttempts: number;
  windowMs: number;
}

export interface LoginLimiter {
  retryAfterSeconds(key: string, now?: number): number;
  recordFailure(key: string, now?: number): void;
  reset(key: string): void;
}

export function createLoginLimiter({ maxAttempts, windowMs }: LoginLimiterOptions): LoginLimiter {
  const failures = new Map<string, number[]>();
  let lastPrune = Date.now();

  const recent = (key: string, now: number): number[] => {
    const stamps = failures.get(key) ?? [];
    return stamps.filter((stamp) => now - stamp < windowMs);
  };

  const prune = (now: number): void => {
    if (now - lastPrune < windowMs) return;
    lastPrune = now;
    for (const key of failures.keys()) {
      if (recent(key, now).length === 0) failures.delete(key);
    }
  };

  return {
    retryAfterSeconds(key, now = Date.now()) {
      const stamps = recent(key, now);
      if (stamps.length === 0) {
        failures.delete(key);
        return 0;
      }
      failures.set(key, stamps);
      if (stamps.length < maxAttempts) return 0;

      const oldest = stamps[0];
      if (oldest === undefined) return 0;
      return Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000));
    },

    recordFailure(key, now = Date.now()) {
      prune(now);
      const stamps = recent(key, now);
      stamps.push(now);
      failures.set(key, stamps.slice(-maxAttempts));
    },

    reset(key) {
      failures.delete(key);
    },
  };
}
