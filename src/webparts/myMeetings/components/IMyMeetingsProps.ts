import { DisplayMode } from '@microsoft/sp-core-library';

export interface IMyMeetingsProps {
  /** Absolute EWS endpoint (from the property pane). */
  ewsUrl: string;
  /** Mailbox/OWA URL opened by the "View All" button. */
  mailboxUrl: string;
  /** Cache lifetime in minutes (0 = always live). */
  cacheMinutes: number;
  /** Page display mode (Read vs Edit) for configuration prompts. */
  displayMode: DisplayMode;
  /** Current user's display name (used in the empty/greeting states). */
  userDisplayName: string;
}
