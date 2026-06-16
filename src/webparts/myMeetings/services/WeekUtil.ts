import { ICalendarDay, IWeekRange, WeekSelection } from '../models/IMeeting';

const DAY_LABELS: string[] = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Pure date helpers for computing the Monday–Sunday week window and the
 * Monday–Saturday display strip. Kept dependency-free so it is cheap to load
 * and trivial to unit test.
 */
export class WeekUtil {

  /** Returns a new Date at local midnight for the supplied date. */
  public static startOfDay(d: Date): Date {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  }

  /** Returns true when two dates fall on the same calendar day. */
  public static isSameDay(a: Date, b: Date): boolean {
    return a.getFullYear() === b.getFullYear()
      && a.getMonth() === b.getMonth()
      && a.getDate() === b.getDate();
  }

  /**
   * Monday of the week containing `ref`. Treats Monday as the first day of the
   * week (ISO-8601), regardless of the runtime locale.
   */
  public static mondayOf(ref: Date): Date {
    const d: Date = WeekUtil.startOfDay(ref);
    const day: number = d.getDay();              // 0 = Sun .. 6 = Sat
    const diff: number = (day === 0 ? -6 : 1 - day);
    d.setDate(d.getDate() + diff);
    return d;
  }

  /**
   * Builds the full week window and display cells for a selection relative to
   * `today`. `today` is injected so the logic stays deterministic/testable.
   */
  public static getWeekRange(selection: WeekSelection, today: Date): IWeekRange {
    const offsetWeeks: number = selection === 'previous' ? -1 : selection === 'next' ? 1 : 0;

    const monday: Date = WeekUtil.mondayOf(today);
    monday.setDate(monday.getDate() + offsetWeeks * 7);

    // Full week window for the data query: Monday 00:00 .. Sunday 23:59:59.999.
    const start: Date = new Date(monday.getTime());
    const end: Date = new Date(monday.getTime());
    end.setDate(end.getDate() + 6);
    end.setHours(23, 59, 59, 999);

    // Display strip: Monday .. Saturday (6 cells), matching the reference UI.
    const days: ICalendarDay[] = [];
    for (let i: number = 0; i < 6; i++) {
      const date: Date = new Date(monday.getTime());
      date.setDate(date.getDate() + i);
      days.push({
        label: DAY_LABELS[date.getDay()],
        dayNumber: date.getDate(),
        date: date,
        isToday: WeekUtil.isSameDay(date, today)
      });
    }

    return {
      start: start,
      end: end,
      days: days,
      key: WeekUtil.toIsoDate(monday)
    };
  }

  /** YYYY-MM-DD in local time, used as a stable cache key. */
  public static toIsoDate(d: Date): string {
    const mm: string = ('0' + (d.getMonth() + 1)).slice(-2);
    const dd: string = ('0' + d.getDate()).slice(-2);
    return `${d.getFullYear()}-${mm}-${dd}`;
  }

  /**
   * Formats a meeting time range for display, e.g. "9:00 AM - 9:30 AM".
   * All-day events render as "All day".
   */
  public static formatTimeRange(start: Date, end: Date, isAllDay: boolean): string {
    if (isAllDay) {
      return 'All day';
    }
    return `${WeekUtil.formatTime(start)} - ${WeekUtil.formatTime(end)}`;
  }

  private static formatTime(d: Date): string {
    let hours: number = d.getHours();
    const minutes: string = ('0' + d.getMinutes()).slice(-2);
    const ampm: string = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    if (hours === 0) {
      hours = 12;
    }
    return `${hours}:${minutes} ${ampm}`;
  }
}
