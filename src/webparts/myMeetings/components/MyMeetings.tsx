import * as React from 'react';
import styles from './MyMeetings.module.scss';

import { IMyMeetingsProps } from './IMyMeetingsProps';
import { IMyMeetingsState } from './IMyMeetingsState';
import { IMeeting, IWeekRange, WeekSelection } from '../models/IMeeting';

import { ExchangeService } from '../services/ExchangeService';
import { IExchangeService, ExchangeError } from '../services/IExchangeService';
import { CacheService } from '../services/CacheService';
import { WeekUtil } from '../services/WeekUtil';

import CalendarStrip from './CalendarStrip';
import MeetingCard from './MeetingCard';
import Pagination from './Pagination';
import { ChevronDownIcon } from './Icons';

const PAGE_SIZE: number = 3;

const WEEK_OPTIONS: { value: WeekSelection; label: string }[] = [
  { value: 'previous', label: 'Previous Week' },
  { value: 'this', label: 'This Week' },
  { value: 'next', label: 'Next Week' }
];

export default class MyMeetings extends React.Component<IMyMeetingsProps, IMyMeetingsState> {

  private exchange: IExchangeService;
  private cache: CacheService;
  private mounted: boolean = false;
  /** Token used to ignore responses from superseded requests. */
  private requestSeq: number = 0;
  /** Active AbortController (typed loosely; AbortController isn't in TS 2.4 lib). */
  private abort: any = null;

  constructor(props: IMyMeetingsProps) {
    super(props);
    this.exchange = new ExchangeService(props.ewsUrl, PAGE_SIZE * 10 + 20);
    this.cache = new CacheService(Math.max(0, props.cacheMinutes) * 60 * 1000);
    this.state = {
      selection: 'this',
      loading: false,
      meetings: [],
      page: 0,
      error: null,
      errorKind: null
    };
  }

  public componentDidMount(): void {
    this.mounted = true;
    this.load(this.state.selection);
  }

  public componentWillUnmount(): void {
    this.mounted = false;
    this.cancelInFlight();
  }

  public render(): JSX.Element {
    const range: IWeekRange = this.currentRange();

    return (
      <div className={styles.myMeetings}>
        <div className={styles.header}>
          <h2 className={styles.title}>My Meetings</h2>
          <div className={styles.selectWrap}>
            <select
              className={styles.weekSelect}
              value={this.state.selection}
              disabled={this.state.loading}
              aria-label="Select week"
              onChange={this.onWeekChange}
            >
              {WEEK_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <ChevronDownIcon className={styles.selectChevron} />
          </div>
        </div>

        <CalendarStrip days={range.days} />

        <div className={styles.content}>
          {this.renderContent()}
        </div>

        <div className={styles.footer}>
          <button
            type="button"
            className={styles.viewAll}
            onClick={this.onViewAll}
            disabled={!this.props.mailboxUrl}
            title={this.props.mailboxUrl ? 'Open your mailbox' : 'Mailbox URL not configured'}
          >
            View all
          </button>
        </div>
      </div>
    );
  }

  // --- content states ------------------------------------------------------

  private renderContent(): JSX.Element {
    if (!this.props.ewsUrl) {
      return this.renderNotConfigured();
    }
    if (this.state.error) {
      return this.renderError();
    }
    if (this.state.loading) {
      return this.renderSkeleton();
    }
    if (this.state.meetings.length === 0) {
      return (
        <div className={styles.empty}>
          <div className={styles.emptyIllustration} aria-hidden={true}>🗓️</div>
          <div className={styles.emptyText}>No meetings this week.</div>
        </div>
      );
    }

    const pageCount: number = Math.ceil(this.state.meetings.length / PAGE_SIZE);
    const startIdx: number = this.state.page * PAGE_SIZE;
    const pageItems: IMeeting[] = this.state.meetings.slice(startIdx, startIdx + PAGE_SIZE);

    return (
      <div>
        <div className={styles.cards}>
          {pageItems.map((m: IMeeting) => <MeetingCard key={m.id} meeting={m} />)}
        </div>
        <Pagination pageCount={pageCount} current={this.state.page} onSelect={this.onPageSelect} />
      </div>
    );
  }

  private renderSkeleton(): JSX.Element {
    const rows: number[] = [0, 1, 2];
    return (
      <div className={styles.cards} aria-busy={true} aria-label="Loading meetings">
        {rows.map((i: number) => (
          <div key={i} className={`${styles.card} ${styles.cardSkeleton}`}>
            <div className={`${styles.skelLine} ${styles.skelTitle}`} />
            <div className={`${styles.skelLine} ${styles.skelShort}`} />
          </div>
        ))}
      </div>
    );
  }

  private renderError(): JSX.Element {
    const retryable: boolean = this.state.errorKind !== 'config';
    return (
      <div className={styles.error} role="alert">
        <div className={styles.errorText}>{this.state.error}</div>
        {retryable ? (
          <button type="button" className={styles.retry} onClick={this.onRetry}>Try again</button>
        ) : null}
      </div>
    );
  }

  private renderNotConfigured(): JSX.Element {
    return (
      <div className={styles.empty}>
        <div className={styles.emptyText}>
          This web part isn’t connected yet. Edit the page and set the Exchange EWS URL in the
          web part properties.
        </div>
      </div>
    );
  }

  // --- data ----------------------------------------------------------------

  private currentRange(): IWeekRange {
    return WeekUtil.getWeekRange(this.state.selection, new Date());
  }

  private load(selection: WeekSelection): void {
    if (!this.props.ewsUrl) {
      return;
    }

    const range: IWeekRange = WeekUtil.getWeekRange(selection, new Date());

    // Serve from cache instantly when available — avoids an EWS round-trip and
    // keeps week-toggling under the load budget.
    const cached: IMeeting[] | undefined = this.props.cacheMinutes > 0 ? this.cache.get(range.key) : undefined;
    if (cached) {
      this.setState({ selection: selection, meetings: cached, loading: false, page: 0, error: null, errorKind: null });
      return;
    }

    this.cancelInFlight();
    const seq: number = ++this.requestSeq;
    const signal: any = this.createAbort();

    this.setState({ selection: selection, loading: true, error: null, errorKind: null, page: 0 });

    this.exchange.getMeetings(range, signal)
      .then((meetings: IMeeting[]) => {
        if (!this.mounted || seq !== this.requestSeq) {
          return; // superseded by a newer selection
        }
        if (this.props.cacheMinutes > 0) {
          this.cache.set(range.key, meetings);
        }
        this.setState({ meetings: meetings, loading: false });
      })
      .catch((err: any) => {
        if (!this.mounted || seq !== this.requestSeq) {
          return;
        }
        if (err && err.name === 'AbortError') {
          return;
        }
        const kind = err instanceof ExchangeError ? err.kind : 'unknown';
        const message = err instanceof ExchangeError
          ? err.message
          : 'Something went wrong loading your meetings.';
        this.setState({ loading: false, error: message, errorKind: kind, meetings: [] });
      });
  }

  private createAbort(): any {
    const AC: any = (window as any).AbortController;
    if (!AC) {
      return undefined; // older browsers: fall back to sequence-token guarding
    }
    this.abort = new AC();
    return this.abort.signal;
  }

  private cancelInFlight(): void {
    if (this.abort) {
      try { this.abort.abort(); } catch (e) { /* ignore */ }
      this.abort = null;
    }
  }

  // --- events --------------------------------------------------------------

  private onWeekChange = (e: React.ChangeEvent<HTMLSelectElement>): void => {
    const selection: WeekSelection = e.target.value as WeekSelection;
    if (selection !== this.state.selection) {
      this.load(selection);
    }
  }

  private onPageSelect = (page: number): void => {
    this.setState({ page: page });
  }

  private onRetry = (): void => {
    this.load(this.state.selection);
  }

  private onViewAll = (): void => {
    if (this.props.mailboxUrl) {
      window.open(this.props.mailboxUrl, '_blank', 'noopener,noreferrer');
    }
  }
}
