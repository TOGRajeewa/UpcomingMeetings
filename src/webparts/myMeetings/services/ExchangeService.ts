import { IMeeting, IWeekRange } from '../models/IMeeting';
import { ExchangeError, IExchangeService } from './IExchangeService';

/** EWS SOAP type/message namespaces. */
const NS_TYPES: string = 'http://schemas.microsoft.com/exchange/services/2006/types';
const NS_MESSAGES: string = 'http://schemas.microsoft.com/exchange/services/2006/messages';

/**
 * Reads the signed-in user's calendar from an on-premises Exchange server via
 * EWS (Exchange Web Services) SOAP.
 *
 * Authentication strategy
 * ------------------------
 * On an ADFS/Kerberos intranet where SharePoint Subscription Edition and
 * Exchange share the same federation realm, the browser can perform SSO to the
 * EWS endpoint transparently. We therefore issue the request with
 * `credentials: 'include'` and let the browser/IWA/ADFS negotiate the session.
 * No tokens are handled in JavaScript, and nothing is persisted.
 *
 * We use `FindItem` + `CalendarView`, which makes Exchange expand recurring
 * meetings into individual occurrences within the requested window — exactly
 * what a weekly view needs, in a single round-trip.
 */
export class ExchangeService implements IExchangeService {

  /**
   * @param ewsUrl   Absolute EWS endpoint, e.g. https://mail.contoso.com/EWS/Exchange.asmx
   * @param maxItems Hard cap on occurrences returned (keeps the payload small).
   */
  constructor(private ewsUrl: string, private maxItems: number = 50) {}

  public getMeetings(range: IWeekRange, signal?: any): Promise<IMeeting[]> {
    if (!this.ewsUrl) {
      return Promise.reject(new ExchangeError('config',
        'The Exchange EWS URL has not been configured for this web part.'));
    }

    const body: string = this.buildFindItemSoap(range.start, range.end);

    // Typed as `any`: the TS 2.4 lib.dom RequestInit predates `signal`.
    const init: any = {
      method: 'POST',
      // The browser negotiates ADFS / Integrated Windows Auth on our behalf.
      credentials: 'include',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8'
      },
      body: body
    };
    if (signal) {
      init.signal = signal;
    }

    return fetch(this.ewsUrl, init)
      .then((resp: Response) => this.toText(resp))
      .then((xml: string) => this.parse(xml))
      .catch((err: any) => {
        if (err instanceof ExchangeError) {
          throw err;
        }
        if (err && err.name === 'AbortError') {
          throw err; // surfaced to caller; not shown as an error state
        }
        // fetch() rejects on network/CORS failures.
        throw new ExchangeError('network',
          'Unable to reach the Exchange server. Please check your network connection.');
      });
  }

  private toText(resp: Response): Promise<string> {
    if (resp.status === 401 || resp.status === 403) {
      throw new ExchangeError('auth',
        'Your session with Exchange has expired or access was denied. Please refresh the page to sign in again.');
    }
    if (resp.status >= 500) {
      throw new ExchangeError('server',
        'The Exchange server returned an error. Please try again later.');
    }
    if (!resp.ok) {
      throw new ExchangeError('server', `Unexpected response from Exchange (HTTP ${resp.status}).`);
    }
    return resp.text();
  }

  /** Builds a minimal FindItem/CalendarView envelope requesting only the fields we render. */
  private buildFindItemSoap(start: Date, end: Date): string {
    const startIso: string = start.toISOString();
    const endIso: string = end.toISOString();
    return '' +
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"' +
      ' xmlns:t="' + NS_TYPES + '"' +
      ' xmlns:m="' + NS_MESSAGES + '">' +
      '<soap:Header>' +
      '<t:RequestServerVersion Version="Exchange2013" />' +
      '</soap:Header>' +
      '<soap:Body>' +
      '<m:FindItem Traversal="Shallow">' +
      '<m:ItemShape>' +
      '<t:BaseShape>IdOnly</t:BaseShape>' +
      '<t:AdditionalProperties>' +
      '<t:FieldURI FieldURI="item:Subject" />' +
      '<t:FieldURI FieldURI="calendar:Start" />' +
      '<t:FieldURI FieldURI="calendar:End" />' +
      '<t:FieldURI FieldURI="calendar:Location" />' +
      '<t:FieldURI FieldURI="calendar:IsAllDayEvent" />' +
      '</t:AdditionalProperties>' +
      '</m:ItemShape>' +
      '<m:CalendarView MaxEntriesReturned="' + this.maxItems + '"' +
      ' StartDate="' + startIso + '" EndDate="' + endIso + '" />' +
      '<m:ParentFolderIds>' +
      '<t:DistinguishedFolderId Id="calendar" />' +
      '</m:ParentFolderIds>' +
      '</m:FindItem>' +
      '</soap:Body>' +
      '</soap:Envelope>';
  }

  private parse(xml: string): IMeeting[] {
    // ADFS frequently answers an unauthenticated XHR with an HTML sign-in page
    // and HTTP 200. Detect that here so we can prompt a re-auth instead of
    // failing to parse.
    const trimmed: string = (xml || '').replace(/^﻿/, '').trim();
    if (trimmed.indexOf('<') !== 0 || /<html/i.test(trimmed.substr(0, 200))) {
      throw new ExchangeError('auth',
        'Your Exchange sign-in is required. Please refresh the page to authenticate.');
    }

    const doc: Document = new DOMParser().parseFromString(xml, 'text/xml');
    if (doc.getElementsByTagName('parsererror').length > 0) {
      throw new ExchangeError('server', 'Received an unreadable response from Exchange.');
    }

    // Surface SOAP faults with the server's own message where available.
    const faults: NodeListOf<Element> = doc.getElementsByTagName('faultstring');
    if (faults.length > 0) {
      throw new ExchangeError('server', faults[0].textContent || 'Exchange returned a SOAP fault.');
    }

    // ResponseCode other than NoError indicates a logical failure.
    const responseCodes: NodeListOf<Element> = doc.getElementsByTagNameNS(NS_MESSAGES, 'ResponseCode');
    if (responseCodes.length > 0) {
      const code: string = responseCodes[0].textContent || '';
      if (code && code !== 'NoError') {
        if (/Access|Authoriz|Privilege/i.test(code)) {
          throw new ExchangeError('auth', 'You do not have permission to read this mailbox calendar.');
        }
        throw new ExchangeError('server', `Exchange responded with: ${code}.`);
      }
    }

    const items: NodeListOf<Element> = doc.getElementsByTagNameNS(NS_TYPES, 'CalendarItem');
    const meetings: IMeeting[] = [];
    for (let i: number = 0; i < items.length; i++) {
      const meeting: IMeeting | undefined = this.toMeeting(items[i], i);
      if (meeting) {
        meetings.push(meeting);
      }
    }

    // CalendarView already returns items in chronological order, but sort
    // defensively so the UI never depends on server ordering.
    meetings.sort((a: IMeeting, b: IMeeting) => a.start.getTime() - b.start.getTime());
    return meetings;
  }

  private toMeeting(el: Element, index: number): IMeeting | undefined {
    const startText: string = this.childText(el, 'Start');
    const endText: string = this.childText(el, 'End');
    if (!startText || !endText) {
      return undefined;
    }
    const itemId: Element | null = this.firstChild(el, 'ItemId');
    const id: string = (itemId && itemId.getAttribute('Id')) || `meeting-${index}`;

    return {
      id: id,
      subject: this.childText(el, 'Subject') || '(No subject)',
      start: new Date(startText),
      end: new Date(endText),
      location: this.childText(el, 'Location'),
      isAllDay: this.childText(el, 'IsAllDayEvent') === 'true'
    };
  }

  private firstChild(parent: Element, localName: string): Element | null {
    const list: NodeListOf<Element> = parent.getElementsByTagNameNS(NS_TYPES, localName);
    return list.length > 0 ? list[0] : null;
  }

  private childText(parent: Element, localName: string): string {
    const child: Element | null = this.firstChild(parent, localName);
    return child && child.textContent ? child.textContent : '';
  }
}
