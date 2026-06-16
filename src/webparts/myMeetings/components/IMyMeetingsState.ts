import { IMeeting, WeekSelection } from '../models/IMeeting';
import { ExchangeErrorKind } from '../services/IExchangeService';

export interface IMyMeetingsState {
  /** Selected week relative to today. */
  selection: WeekSelection;
  /** True while a fetch is in flight. */
  loading: boolean;
  /** Meetings for the selected week (full set; paginated in the view). */
  meetings: IMeeting[];
  /** Zero-based page index for the 3-per-page pager. */
  page: number;
  /** User-facing error message, or null when healthy. */
  error: string | null;
  /** Error category, used to decide whether to show a retry affordance. */
  errorKind: ExchangeErrorKind | null;
}
