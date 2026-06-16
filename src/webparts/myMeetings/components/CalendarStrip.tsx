import * as React from 'react';
import styles from './MyMeetings.module.scss';
import { ICalendarDay } from '../models/IMeeting';

export interface ICalendarStripProps {
  days: ICalendarDay[];
}

/** Horizontal Mon–Sat strip; the current day is highlighted. Purely presentational. */
const CalendarStrip: React.StatelessComponent<ICalendarStripProps> = (props: ICalendarStripProps) => (
  <div className={styles.calendarStrip} role="list" aria-label="Week">
    {props.days.map((d: ICalendarDay) => (
      <div
        key={d.date.getTime()}
        role="listitem"
        className={d.isToday ? `${styles.dayCell} ${styles.dayCellToday}` : styles.dayCell}
        aria-current={d.isToday ? 'date' : undefined}
      >
        <span className={styles.dayLabel}>{d.label}</span>
        <span className={styles.dayNumber}>{d.dayNumber}</span>
      </div>
    ))}
  </div>
);

export default CalendarStrip;
