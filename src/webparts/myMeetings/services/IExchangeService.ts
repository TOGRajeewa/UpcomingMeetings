import { IMeeting, IWeekRange } from '../models/IMeeting';

/** Categorized failure reasons so the UI can render the right message. */
export type ExchangeErrorKind = 'auth' | 'config' | 'network' | 'server' | 'unknown';

/**
 * Plain error-like class (does not `extend Error`) so it compiles cleanly under
 * the TypeScript 2.4.2 / es5 target shipped with SPFx 1.4.1, where subclassing
 * Error and `Object.setPrototypeOf` are problematic. `instanceof ExchangeError`
 * still works for branching on failure kind.
 */
export class ExchangeError {
  public name: string = 'ExchangeError';
  constructor(public kind: ExchangeErrorKind, public message: string) {}
}

export interface IExchangeService {
  /**
   * Fetches the user's calendar meetings within the given week window.
   * Implementations expand recurring meetings and return them sorted by start.
   * `signal` is an optional AbortController signal (typed loosely for TS 2.4).
   */
  getMeetings(range: IWeekRange, signal?: any): Promise<IMeeting[]>;
}
