/**
 * A single calendar meeting, normalized from an Exchange EWS CalendarItem.
 */
export interface IMeeting {
  /** Unique EWS item id (used as a React key). */
  id: string;
  /** Meeting subject / title. */
  subject: string;
  /** Start time (local Date). */
  start: Date;
  /** End time (local Date). */
  end: Date;
  /** Location string ('' when none). */
  location: string;
  /** True for all-day events. */
  isAllDay: boolean;
}

/** Identifies which week to display, relative to the current week. */
export type WeekSelection = 'previous' | 'this' | 'next';

/** A single cell in the horizontal calendar strip. */
export interface ICalendarDay {
  /** Three-letter weekday label, e.g. "Mon". */
  label: string;
  /** Day-of-month number, e.g. 15. */
  dayNumber: number;
  /** The full date for this cell. */
  date: Date;
  /** True when this cell is the actual current day. */
  isToday: boolean;
}

/** A date range for an EWS CalendarView query (UTC boundaries). */
export interface IWeekRange {
  /** Inclusive start (Monday 00:00:00, local time). */
  start: Date;
  /** Exclusive/inclusive end (Sunday 23:59:59, local time). */
  end: Date;
  /** Display cells for the calendar strip (Mon–Sat). */
  days: ICalendarDay[];
  /** Stable cache key for this week (ISO date of the Monday). */
  key: string;
}
