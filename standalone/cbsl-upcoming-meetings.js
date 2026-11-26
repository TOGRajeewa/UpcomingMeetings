/* ============================================================================
 * CBSL Portal — My Meetings widget (standalone)
 * ----------------------------------------------------------------------------
 * Plain React via the global React/ReactDOM UMD builds (no JSX/transpile step),
 * matching cbsl-portal.bundle.js conventions. Self-registers with the
 * bootstrapper:  CBSL.register('MyMeetings', mountFn).
 *
 * Mounts into (already present in New_Home.aspx):
 *   <div id="my-meetings" data-react-component="MyMeetings" data-lazy="false"
 *        class="cbsl-skel tw-rounded-xl tw-min-h-[320px]"></div>
 *
 * Shows the signed-in user's Exchange calendar for Previous / This / Next week:
 *   - week label (top-right), ‹ Mon–Sun day strip › (arrows step the week),
 *   - click a day to list that day's meetings (opens on today; an arrow step
 *     selects the Monday of the new week),
 *   - up to 3 meeting cards (title + time + location), dot pager, View all.
 *
 * Data source: on-prem Exchange EWS (FindItem + CalendarView) reached through
 * the SAME-ORIGIN reverse proxy (see docs/exchange-proxy.md). No cross-origin
 * call, no tokens in JS — the browser authenticates via ADFS/IWA transparently.
 *
 * Configuration (either place; data-* wins):
 *   1) attributes on the mount div:
 *        data-ews-url="/ews/Exchange.asmx"
 *        data-mailbox-url="https://mail.cbsl.gov.lk/owa"
 *        data-cache-minutes="5"
 *   2) CBSL.config.upcomingMeetings = { ewsUrl, mailboxUrl, cacheMinutes }
 * ========================================================================== */
(function (window) {
  'use strict';

  var React = window.React;
  var ReactDOM = window.ReactDOM;
  var CBSL = window.CBSL;
  if (!React || !ReactDOM || !CBSL) {
    if (window.console) console.error('[CBSL] My Meetings: React / ReactDOM / bootstrapper not loaded.');
    return;
  }

  var h = React.createElement;
  var useState = React.useState, useEffect = React.useEffect, useRef = React.useRef;

  var NS_T = 'http://schemas.microsoft.com/exchange/services/2006/types';
  var NS_M = 'http://schemas.microsoft.com/exchange/services/2006/messages';
  var CACHE_PREFIX = 'cbsl:mymeetings:v1:';
  var PAGE_SIZE = 3;

  // Label for the week currently on screen (offset -1 | 0 | +1).
  function weekLabel(offset) {
    return offset < 0 ? 'Previous Week' : offset > 0 ? 'Next Week' : 'This Week';
  }

  /* ----------------------------------------------------------------------- *
   * DEFAULTS — the lowest-priority config source. Edit these if you want to
   * keep configuration entirely in this standalone file (no bundle edit, no
   * page edit). Overridden by CBSL.config.upcomingMeetings, which is in turn
   * overridden by data-* attributes on the mount div.
   *   ewsUrl:     same-origin reverse-proxy path, e.g. '/ews/Exchange.asmx'
   *   mailboxUrl: OWA/mailbox URL for the "View all" button
   *   cacheMinutes: per-session cache TTL (0 = always live)
   * ----------------------------------------------------------------------- */
  var DEFAULTS = {
    // Same-origin reverse-proxy path to EWS (see ../docs/exchange-proxy.md).
    // Site-relative -> resolved against the current origin. CONFIRM once the
    // /ews reverse proxy is deployed; point this at the proxy, NOT directly at
    // Exchange.
    ewsUrl: '/ews/Exchange.asmx',
    // "View all" opens the user's mailbox. CONFIRM the OWA URL for your tenant.
    mailboxUrl: 'https://sandesha.cbsl.lk/owa',   // environment-specific — see docs/UAT-DEPLOYMENT-CHECKLIST.md
    // Per-session cache TTL in minutes (0 = always live).
    cacheMinutes: 5
  };

  /* ----------------------------------------------------------------------- *
   * Config resolution — data-* attributes override CBSL.config.
   * ----------------------------------------------------------------------- */
  function resolveConfig(dataset) {
    var c = (CBSL.config && CBSL.config.upcomingMeetings) || {};
    // Priority: data-* attribute  >  CBSL.config.upcomingMeetings  >  DEFAULTS.
    function pick(dsKey, cKey) {
      var v = dataset && dataset[dsKey];
      if (v === undefined || v === null || v === '') v = c[cKey];
      if (v === undefined || v === null || v === '') v = DEFAULTS[cKey];
      return v;
    }
    var mins = parseInt(pick('cacheMinutes', 'cacheMinutes'), 10);
    return {
      ewsUrl: resolveEwsUrl(pick('ewsUrl', 'ewsUrl') || ''),
      mailboxUrl: pick('mailboxUrl', 'mailboxUrl') || '',
      cacheMinutes: isNaN(mins) ? 0 : mins,
      maxItems: 50
    };
  }

  // Absolute URL -> as-is; site-relative -> resolved against the current origin.
  function resolveEwsUrl(u) {
    if (!u) return '';
    if (/^https?:\/\//i.test(u)) return u;
    return location.protocol + '//' + location.host + (u.charAt(0) === '/' ? '' : '/') + u;
  }

  /* ----------------------------------------------------------------------- *
   * Date helpers (Monday-based week; display strip Mon–Sun).
   * ----------------------------------------------------------------------- */
  function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0); }
  function sameDay(a, b) {
    return !!a && !!b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }
  function mondayOf(ref) {
    var d = startOfDay(ref);
    var day = d.getDay();                 // 0 = Sun .. 6 = Sat
    d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
    return d;
  }
  var DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function getWeekRange(selection, today) {
    // Accepts a numeric offset (0 = this week); the legacy string values are
    // still understood so any caller/cached state keeps working.
    var offset = typeof selection === 'number' ? selection
      : selection === 'previous' ? -1 : selection === 'next' ? 1 : 0;
    var monday = mondayOf(today);
    monday.setDate(monday.getDate() + offset * 7);

    var start = new Date(monday.getTime());
    var end = new Date(monday.getTime());
    end.setDate(end.getDate() + 6);
    end.setHours(23, 59, 59, 999);        // full week window Mon..Sun for the query

    var days = [];                         // Mon..Sun display cells
    for (var i = 0; i < 7; i++) {
      var dt = new Date(monday.getTime());
      dt.setDate(dt.getDate() + i);
      days.push({ label: DAY_LABELS[dt.getDay()], dayNumber: dt.getDate(), date: dt, isToday: sameDay(dt, today) });
    }
    return { start: start, end: end, days: days, key: isoDate(monday) };
  }

  function isoDate(d) {
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }
  function fmtTime(d) {
    var hh = d.getHours(), mm = ('0' + d.getMinutes()).slice(-2), ap = hh >= 12 ? 'PM' : 'AM';
    hh = hh % 12; if (hh === 0) hh = 12;
    return hh + ':' + mm + ' ' + ap;
  }
  function fmtRange(s, e, allDay) { return allDay ? 'All day' : (fmtTime(s) + ' - ' + fmtTime(e)); }
  function chunk(arr, n) { var out = []; for (var i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; }

  // Meetings touching the given local day. Overlap (not start-date) so all-day
  // and multi-day items show on every day they span; an all-day item ends at
  // next-day 00:00, which the strict > keeps off the following day.
  function meetingsOnDay(list, day) {
    var from = startOfDay(day);
    var to = new Date(from.getTime()); to.setDate(to.getDate() + 1);
    return list.filter(function (m) {
      return m.start < to && (m.end > from || sameDay(m.start, from));
    });
  }

  /* ----------------------------------------------------------------------- *
   * Session cache (per week, TTL). Never outlives the tab.
   * ----------------------------------------------------------------------- */
  function cacheGet(key, ttlMs) {
    try {
      var raw = window.sessionStorage.getItem(CACHE_PREFIX + key);
      if (!raw) return null;
      var env = JSON.parse(raw);
      if (!env || (Date.now() - env.ts) > ttlMs) return null;
      return env.meetings.map(function (m) {
        return { id: m.id, subject: m.subject, start: new Date(m.start), end: new Date(m.end), location: m.location, isAllDay: m.isAllDay };
      });
    } catch (e) { return null; }
  }
  function cacheSet(key, meetings) {
    try { window.sessionStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ ts: Date.now(), meetings: meetings })); }
    catch (e) { /* private mode / full — degrade silently */ }
  }

  /* ----------------------------------------------------------------------- *
   * EWS service — SOAP FindItem + CalendarView (expands recurrences).
   * Errors are normalized to { kind: 'auth'|'config'|'network'|'server', message }.
   * ----------------------------------------------------------------------- */
  function ewsError(kind, message) { return { __ews: true, kind: kind, message: message }; }

  function buildSoap(start, end, maxItems) {
    return '' +
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"' +
      ' xmlns:t="' + NS_T + '" xmlns:m="' + NS_M + '">' +
      '<soap:Header><t:RequestServerVersion Version="Exchange2013" /></soap:Header>' +
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
      '<m:CalendarView MaxEntriesReturned="' + maxItems + '" StartDate="' + start.toISOString() + '" EndDate="' + end.toISOString() + '" />' +
      '<m:ParentFolderIds><t:DistinguishedFolderId Id="calendar" /></m:ParentFolderIds>' +
      '</m:FindItem>' +
      '</soap:Body></soap:Envelope>';
  }

  function fetchMeetings(ewsUrl, range, maxItems, signal) {
    if (!ewsUrl) return Promise.reject(ewsError('config', 'The Exchange EWS URL has not been configured.'));
    var init = {
      method: 'POST',
      credentials: 'include',                 // ADFS/IWA SSO handled by the browser
      headers: { 'Content-Type': 'text/xml; charset=utf-8' },
      body: buildSoap(range.start, range.end, maxItems)
    };
    if (signal) init.signal = signal;

    return fetch(ewsUrl, init).then(function (resp) {
      if (resp.status === 401 || resp.status === 403) {
        throw ewsError('auth', 'Your Exchange session expired. Please refresh the page to sign in again.');
      }
      if (resp.status >= 500) throw ewsError('server', 'The Exchange server returned an error. Please try again later.');
      if (!resp.ok) throw ewsError('server', 'Unexpected response from Exchange (HTTP ' + resp.status + ').');
      return resp.text();
    }).then(function (xml) {
      return parseEws(xml);
    }, function (err) {
      if (err && err.__ews) throw err;
      if (err && err.name === 'AbortError') throw err;
      throw ewsError('network', 'Unable to reach the Exchange server. Please check your connection.');
    });
  }

  function parseEws(xml) {
    var trimmed = (xml || '').replace(/^﻿/, '').replace(/^\s+/, '');
    if (trimmed.indexOf('<') !== 0 || /<html/i.test(trimmed.substr(0, 200))) {
      throw ewsError('auth', 'Exchange sign-in is required. Please refresh the page to authenticate.');
    }
    var doc = new DOMParser().parseFromString(xml, 'text/xml');
    if (doc.getElementsByTagName('parsererror').length) throw ewsError('server', 'Received an unreadable response from Exchange.');

    var faults = doc.getElementsByTagName('faultstring');
    if (faults.length) throw ewsError('server', faults[0].textContent || 'Exchange returned a SOAP fault.');

    var codes = doc.getElementsByTagNameNS(NS_M, 'ResponseCode');
    if (codes.length) {
      var code = codes[0].textContent || '';
      if (code && code !== 'NoError') {
        if (/Access|Authoriz|Privilege/i.test(code)) throw ewsError('auth', 'You do not have permission to read this mailbox calendar.');
        throw ewsError('server', 'Exchange responded with: ' + code + '.');
      }
    }

    var items = doc.getElementsByTagNameNS(NS_T, 'CalendarItem');
    var out = [];
    for (var i = 0; i < items.length; i++) {
      var el = items[i];
      var startText = childText(el, 'Start'), endText = childText(el, 'End');
      if (!startText || !endText) continue;
      var idEl = firstChild(el, 'ItemId');
      out.push({
        id: (idEl && idEl.getAttribute('Id')) || ('meeting-' + i),
        subject: childText(el, 'Subject') || '(No subject)',
        start: new Date(startText),
        end: new Date(endText),
        location: childText(el, 'Location') || '',
        isAllDay: childText(el, 'IsAllDayEvent') === 'true'
      });
    }
    out.sort(function (a, b) { return a.start.getTime() - b.start.getTime(); });
    return out;
  }

  function firstChild(parent, name) { var l = parent.getElementsByTagNameNS(NS_T, name); return l.length ? l[0] : null; }
  function childText(parent, name) { var c = firstChild(parent, name); return c && c.textContent ? c.textContent : ''; }

  /* ----------------------------------------------------------------------- *
   * Inline SVG icons (no icon font — keeps the widget light). Inherit color.
   * ----------------------------------------------------------------------- */
  function clockIcon() {
    return h('svg', { width: 13, height: 13, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, 'aria-hidden': 'true' }, [
      h('circle', { key: 'c', cx: 8, cy: 8, r: 6.3 }),
      h('path', { key: 'p', d: 'M8 4.5V8l2.4 1.6', strokeLinecap: 'round', strokeLinejoin: 'round' })
    ]);
  }
  function pinIcon() {
    return h('svg', { width: 13, height: 13, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, 'aria-hidden': 'true' }, [
      h('path', { key: 'p', d: 'M8 14.5s4.5-4.2 4.5-7.5a4.5 4.5 0 1 0-9 0c0 3.3 4.5 7.5 4.5 7.5z', strokeLinejoin: 'round' }),
      h('circle', { key: 'c', cx: 8, cy: 7, r: 1.7 })
    ]);
  }
  function chevronDown() {
    return h('svg', { width: 12, height: 12, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, 'aria-hidden': 'true' },
      h('path', { d: 'M4 6l4 4 4-4', strokeLinecap: 'round', strokeLinejoin: 'round' }));
  }

  /* ----------------------------------------------------------------------- *
   * Presentational pieces.
   * ----------------------------------------------------------------------- */
  // Week navigation: < arrow | Mon-Sat strip | > arrow. Replaces the old week
  // dropdown. Bounded to the same previous/this/next range the dropdown
  // offered, so the arrows disable at either end rather than paging EWS
  // through unlimited weeks.
  function weekArrow(dir, label, disabled, onStep) {
    return h('button', {
      key: 'a' + dir, type: 'button', 'aria-label': label, title: label, disabled: disabled,
      onClick: function () { if (!disabled) onStep(dir); },
      className: 'tw-shrink-0 tw-h-7 tw-w-7 tw-flex tw-items-center tw-justify-center tw-rounded-full ' +
        'tw-border-0 tw-bg-transparent tw-text-base tw-leading-none ' +
        (disabled ? '' : 'tw-text-cbsl-maroon tw-cursor-pointer hover:tw-bg-cbsl-surface-2'),
      // Disabled colour is inline on purpose: cbsl-custom.css has
      // `#cbsl-home button:disabled { color: inherit }` (1-1-1), which beats any
      // tw- text utility and painted the disabled arrow in the card's ink colour
      // (white in dark theme) — brighter than the live maroon arrow. Inline
      // style outranks that rule; muted + faded reads as disabled in both themes.
      style: disabled
        ? { cursor: 'default', color: 'var(--cbsl-mute)', opacity: 0.4 }   // tw-cursor-default is not in the built CSS
        : { cursor: 'pointer' }
    }, dir < 0 ? '‹' : '›');
  }
  // Each day is a button: selected = filled maroon; today (when not selected) =
  // maroon ring, so "where am I" stays visible while browsing other days.
  function CalendarStrip(days, offset, selectedDate, onStep, onPick) {
    return h('div', { className: 'tw-flex tw-items-center tw-gap-1 tw-mt-4 tw-mb-3 tw-pb-3 tw-border-b tw-border-cbsl-line' }, [
      weekArrow(-1, 'Previous week', offset <= -1, onStep),
      h('div', { key: 'd', className: 'tw-flex tw-flex-1 tw-gap-1 tw-min-w-0' },
      days.map(function (d) {
        var selected = sameDay(d.date, selectedDate);
        var numCls = 'tw-h-8 tw-w-8 tw-flex tw-items-center tw-justify-center tw-rounded-full tw-text-sm tw-font-semibold ' +
          (selected ? 'tw-bg-cbsl-maroon tw-text-white'
            : 'tw-text-cbsl-ink' + (d.isToday ? ' tw-ring-2 tw-ring-cbsl-maroon' : ''));
        return h('button', {
          key: d.date.getTime(), type: 'button',
          'aria-pressed': selected, 'aria-current': d.isToday ? 'date' : undefined,
          'aria-label': d.label + ' ' + d.dayNumber + (d.isToday ? ' (today)' : ''),
          onClick: function () { onPick(d.date); },
          className: 'tw-flex-1 tw-flex tw-flex-col tw-items-center tw-gap-1.5 tw-min-w-0 tw-border-0 tw-bg-transparent tw-cursor-pointer',
          style: { minWidth: 0, padding: 0, margin: 0, cursor: 'pointer' }   // SharePoint core.css pads/min-widths <button>
        }, [
          h('span', { key: 'l', className: 'tw-text-[11px] tw-font-medium tw-text-cbsl-mute' }, d.label),
          h('span', { key: 'n', className: numCls }, d.dayNumber)
        ]);
      })),
      weekArrow(1, 'Next week', offset >= 1, onStep)
    ]);
  }

  function MeetingCard(m, isFirst) {
    var cls = 'tw-py-3' + (isFirst ? '' : ' tw-border-t tw-border-cbsl-line');
    var meta = [
      h('span', { key: 't', className: 'tw-inline-flex tw-items-center tw-gap-1.5' }, [clockIcon(), h('span', { key: 'x' }, fmtRange(m.start, m.end, m.isAllDay))])
    ];
    if (m.location) {
      meta.push(h('span', { key: 'l', className: 'tw-inline-flex tw-items-center tw-gap-1.5 tw-min-w-0' }, [
        pinIcon(), h('span', { key: 'x', className: 'tw-truncate', title: m.location }, m.location)
      ]));
    }
    return h('div', { key: m.id, className: cls }, [
      h('div', { key: 't', className: 'tw-text-sm tw-font-semibold tw-text-cbsl-ink tw-mb-1 tw-truncate', title: m.subject }, m.subject),
      h('div', { key: 'm', className: 'tw-flex tw-items-center tw-gap-x-4 tw-gap-y-1 tw-flex-wrap tw-text-xs tw-text-cbsl-mute' }, meta)
    ]);
  }

  function Dots(pageCount, current, onSelect) {
    if (pageCount <= 1) return null;
    var dots = [];
    for (var i = 0; i < pageCount; i++) {
      (function (idx) {
        var on = idx === current;
        dots.push(h('button', {
          key: idx, type: 'button', 'aria-label': 'Meetings page ' + (idx + 1),
          onClick: function () { onSelect(idx); },
          className: 'tw-h-2 tw-rounded-full tw-transition-all ' + (on ? 'tw-w-6 tw-bg-cbsl-maroon' : 'tw-w-2 tw-bg-cbsl-line hover:tw-bg-cbsl-mute')
        }));
      })(i);
    }
    return h('div', { className: 'tw-flex tw-justify-center tw-items-center tw-gap-2 tw-mt-3' }, dots);
  }

  /* ----------------------------------------------------------------------- *
   * Main component.
   * ----------------------------------------------------------------------- */
  function MyMeetings(props) {
    var conf = props.conf;
    var s0 = useState(0), selection = s0[0], setSelection = s0[1];   // week offset: -1 | 0 | +1
    var s1 = useState(true), loading = s1[0], setLoading = s1[1];
    var s2 = useState([]), meetings = s2[0], setMeetings = s2[1];
    var s3 = useState(0), page = s3[0], setPage = s3[1];
    var s4 = useState(null), error = s4[0], setError = s4[1];
    var s5 = useState(0), reload = s5[0], setReload = s5[1];
    var s6 = useState(function () { return startOfDay(new Date()); }), selectedDate = s6[0], setSelectedDate = s6[1];
    var seq = useRef(0);
    var abortRef = useRef(null);

    useEffect(function () {
      var mySeq = ++seq.current;
      var range = getWeekRange(selection, new Date());
      setPage(0);
      setError(null);

      // Cache hit -> instant, no round-trip.
      var cached = conf.cacheMinutes > 0 ? cacheGet(range.key, conf.cacheMinutes * 60000) : null;
      if (cached) { setMeetings(cached); setLoading(false); return; }

      setLoading(true);
      if (abortRef.current) { try { abortRef.current.abort(); } catch (e) {} }
      var AC = window.AbortController;
      var ctrl = AC ? new AC() : null;
      abortRef.current = ctrl;

      fetchMeetings(conf.ewsUrl, range, conf.maxItems, ctrl ? ctrl.signal : undefined).then(function (list) {
        if (mySeq !== seq.current) return;
        if (conf.cacheMinutes > 0) cacheSet(range.key, list);
        setMeetings(list); setLoading(false);
      }, function (err) {
        if (mySeq !== seq.current || (err && err.name === 'AbortError')) return;
        setMeetings([]);
        setError(err && err.__ews ? err : ewsError('unknown', 'Something went wrong loading your meetings.'));
        setLoading(false);
      });

      return function () { if (ctrl) { try { ctrl.abort(); } catch (e) {} } };
    }, [selection, reload]);

    function onViewAll() {
      if (conf.mailboxUrl) window.open(conf.mailboxUrl, '_blank', 'noopener,noreferrer');
    }

    // The week is fetched/cached as a whole; picking a day just filters it
    // client-side, so day clicks never hit EWS.
    var range = getWeekRange(selection, new Date());
    var dayMeetings = meetingsOnDay(meetings, selectedDate);

    // Arrow: step the week (bounded -1..+1) and select that week's Monday.
    function onStep(dir) {
      var next = Math.max(-1, Math.min(1, selection + dir));
      if (next === selection) return;
      setSelection(next);
      setSelectedDate(getWeekRange(next, new Date()).start);
    }
    function onPick(date) {
      setSelectedDate(date);
      setPage(0);
    }

    // ---- content ----
    var content;
    if (!conf.ewsUrl) {
      content = h('p', { className: 'tw-text-center tw-text-sm tw-text-cbsl-mute tw-py-8' },
        'My Meetings isn’t connected yet — set the EWS URL (data-ews-url or CBSL.config.upcomingMeetings).');
    } else if (error) {
      content = h('div', { className: 'tw-flex tw-flex-col tw-items-center tw-gap-3 tw-py-8 tw-text-center' }, [
        h('p', { key: 'm', className: 'tw-text-sm', style: { color: '#a4262c' } }, error.message),
        error.kind !== 'config' ? h('button', {
          key: 'r', type: 'button', onClick: function () { setReload(function (n) { return n + 1; }); },
          className: 'tw-text-sm tw-text-cbsl-maroon tw-font-semibold tw-bg-cbsl-surface-2 hover:tw-bg-cbsl-line tw-rounded-lg tw-px-4 tw-py-1.5 tw-border-0 tw-cursor-pointer'
        }, 'Try again') : null
      ]);
    } else if (loading) {
      content = h('div', { className: 'tw-flex tw-flex-col' }, [0, 1, 2].map(function (k) {
        return h('div', { key: k, className: 'tw-py-3' + (k ? ' tw-border-t tw-border-cbsl-line' : '') }, [
          h('div', { key: 'a', className: 'cbsl-skel tw-rounded tw-h-3.5 tw-w-2/3 tw-mb-2' }),
          h('div', { key: 'b', className: 'cbsl-skel tw-rounded tw-h-3 tw-w-1/2' })
        ]);
      }));
    } else if (!dayMeetings.length) {
      content = h('p', { className: 'tw-text-center tw-text-sm tw-text-cbsl-mute tw-py-8' }, 'No meetings on this day.');
    } else {
      var pages = chunk(dayMeetings, PAGE_SIZE);
      var safe = Math.min(page, pages.length - 1);
      var cur = pages[safe] || [];
      content = h('div', null, [
        h('div', { key: 'list' }, cur.map(function (m, i) { return MeetingCard(m, i === 0); })),
        Dots(pages.length, safe, setPage)
      ]);
    }

    // ---- header (title + week dropdown) ----
    var header = h('div', { className: 'tw-flex tw-items-center tw-justify-between tw-gap-2' }, [
      h('h2', { key: 'h', className: 'tw-flex tw-items-center tw-gap-2 tw-text-cbsl-ink tw-text-lg tw-font-semibold' }, [
        h('span', { key: 'b', className: 'tw-inline-block tw-w-1 tw-h-5 tw-bg-cbsl-maroon tw-rounded' }),
        'My Meetings'
      ]),
      // Which week is showing. Read-only now — the arrows beside the day strip
      // do the navigating, so there is no dropdown to keep in sync.
      h('span', { key: 'sel', className: 'tw-text-sm tw-font-semibold tw-text-cbsl-maroon tw-whitespace-nowrap' }, weekLabel(selection))
    ]);

    // ---- View all ----
    var footer = h('button', {
      type: 'button', onClick: onViewAll, disabled: !conf.mailboxUrl,
      title: conf.mailboxUrl ? 'Open your mailbox' : 'Mailbox URL not configured',
      className: 'tw-w-full tw-mt-4 tw-rounded-lg tw-py-2.5 tw-text-sm tw-font-semibold tw-border-0 tw-cursor-pointer ' +
        (conf.mailboxUrl ? 'tw-text-cbsl-maroon tw-bg-cbsl-surface-2 hover:tw-bg-cbsl-line' : 'tw-text-cbsl-mute tw-bg-cbsl-surface-2 tw-cursor-default')
    }, 'View all');

    // No tw-h-full here. This card is a plain content-height widget in the
    // right rail (a flex column); height:100% resolved against an auto-height
    // mount and left the card's real height out of the flow, so the Calendar
    // heading below rendered on top of its lower edge — the same failure the
    // Discussions/Employee Blogs cards hit against Event Albums.
    return h('div', { className: 'tw-bg-cbsl-surface tw-rounded-xl tw-border tw-border-cbsl-line tw-p-4 tw-flex tw-flex-col' }, [
      h('div', { key: 'hd' }, header),
      h('div', { key: 'cal' }, CalendarStrip(range.days, selection, selectedDate, onStep, onPick)),
      h('div', { key: 'ct', className: 'tw-flex-1' }, content),
      h('div', { key: 'ft' }, footer)
    ]);
  }

  /* ----------------------------------------------------------------------- *
   * Registration — custom mount fn so the component receives resolved config
   * (bootstrapper passes ctx.dataset from the mount div's data-* attributes).
   * ----------------------------------------------------------------------- */
  CBSL.register('MyMeetings', function (el, ctx) {
    var conf = resolveConfig(ctx && ctx.dataset);
    var element = h(MyMeetings, { conf: conf });
    if (ReactDOM.createRoot) {
      var root = ReactDOM.createRoot(el);
      root.render(element);
      return function () { root.unmount(); };
    }
    ReactDOM.render(element, el);
    return function () { ReactDOM.unmountComponentAtNode(el); };
  });

})(window);
