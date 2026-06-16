import { IMeeting } from '../models/IMeeting';

interface ICacheEnvelope {
  ts: number;
  meetings: IMeeting[];
}

/**
 * Small session-scoped cache for meeting results, keyed by week. Cuts repeat
 * EWS round-trips when the user toggles back and forth between weeks within a
 * browsing session. sessionStorage (not localStorage) is used so calendar data
 * never outlives the tab — important for shared/kiosk intranet machines.
 */
export class CacheService {
  private static readonly PREFIX: string = 'upcomingMeetings:v1:';

  constructor(private ttlMs: number) {}

  public get(weekKey: string): IMeeting[] | undefined {
    const raw: string | null = CacheService.safeGet(CacheService.PREFIX + weekKey);
    if (!raw) {
      return undefined;
    }
    try {
      const env: ICacheEnvelope = JSON.parse(raw);
      if (!env || (Date.now() - env.ts) > this.ttlMs) {
        return undefined;
      }
      // Dates are serialized as ISO strings; rehydrate them.
      return env.meetings.map((m: IMeeting) => ({
        ...m,
        start: new Date(m.start),
        end: new Date(m.end)
      }));
    } catch (e) {
      return undefined;
    }
  }

  public set(weekKey: string, meetings: IMeeting[]): void {
    const env: ICacheEnvelope = { ts: Date.now(), meetings: meetings };
    CacheService.safeSet(CacheService.PREFIX + weekKey, JSON.stringify(env));
  }

  /** Drops every cached week (e.g. after a manual refresh). */
  public clear(): void {
    try {
      const toRemove: string[] = [];
      for (let i: number = 0; i < window.sessionStorage.length; i++) {
        const k: string | null = window.sessionStorage.key(i);
        if (k && k.indexOf(CacheService.PREFIX) === 0) {
          toRemove.push(k);
        }
      }
      toRemove.forEach((k: string) => window.sessionStorage.removeItem(k));
    } catch (e) {
      /* storage disabled — nothing to clear */
    }
  }

  private static safeGet(key: string): string | null {
    try {
      return window.sessionStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  private static safeSet(key: string, value: string): void {
    try {
      window.sessionStorage.setItem(key, value);
    } catch (e) {
      /* storage full or disabled (private mode) — degrade silently */
    }
  }
}
