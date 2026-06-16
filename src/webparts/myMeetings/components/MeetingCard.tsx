import * as React from 'react';
import styles from './MyMeetings.module.scss';
import { IMeeting } from '../models/IMeeting';
import { WeekUtil } from '../services/WeekUtil';
import { ClockIcon, PinIcon } from './Icons';

export interface IMeetingCardProps {
  meeting: IMeeting;
}

/**
 * One meeting row: title on top, then time (clock icon) and location (pin icon)
 * on a single meta row. Borderless/flat to match the reference UI.
 * Subject/location render as text nodes, so React escapes them — no XSS from
 * mailbox content.
 */
const MeetingCard: React.StatelessComponent<IMeetingCardProps> = (props: IMeetingCardProps) => {
  const m: IMeeting = props.meeting;
  const time: string = WeekUtil.formatTimeRange(m.start, m.end, m.isAllDay);
  return (
    <div className={styles.card}>
      <div className={styles.cardTitle} title={m.subject}>{m.subject}</div>
      <div className={styles.cardMeta}>
        <span className={styles.metaItem}>
          <ClockIcon className={styles.metaIcon} title="Time" />
          <span className={styles.metaText}>{time}</span>
        </span>
        {m.location ? (
          <span className={styles.metaItem}>
            <PinIcon className={styles.metaIcon} title="Location" />
            <span className={styles.metaText} title={m.location}>{m.location}</span>
          </span>
        ) : null}
      </div>
    </div>
  );
};

export default MeetingCard;
