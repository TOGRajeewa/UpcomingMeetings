# My Meetings — SPFx Web Part

Displays the signed-in user's Exchange calendar meetings for the selected week
(Previous / This / Next) on a SharePoint Subscription Edition intranet page.

![reference](image.png)

> The visual reference (`image.png`) was not present in the repository when this
> solution was built. The UI was implemented from the written specification:
> title (top-left), week dropdown (top-right), Mon–Sat calendar strip with the
> current day highlighted, up to 3 meeting cards (title + time/clock + location/pin),
> dot pagination, and a **View All** button. Drop the real mock-up in as
> `image.png` and adjust `MyMeetings.module.scss` tokens to match exactly.

---

## Features

| Requirement | Implementation |
|---|---|
| Week selector (Previous / This / Next, default This) | Native styled `<select>` — no full page reload; re-queries on change |
| Max 3 meetings shown | `PAGE_SIZE = 3` slice in `MyMeetings.tsx` |
| Meeting card: title, time (clock), location (pin) | `MeetingCard.tsx` + inline SVG `Icons.tsx` |
| Mon–Sat calendar strip, today highlighted | `CalendarStrip.tsx` + `WeekUtil.getWeekRange` |
| Dot pagination for meetings beyond 3 | `Pagination.tsx` |
| View All → mailbox | `mailboxUrl` property, opens in a new tab |
| Sub-second load | First paint is instant (skeleton); data loads async; session cache avoids repeat round-trips; no heavy UI libs |

## Architecture

```
MyMeetingsWebPart.ts        SPFx host: property pane (EWS URL, mailbox URL, cache TTL), React mount
└─ components/
   ├─ MyMeetings.tsx        Orchestrator: state, week selection, fetch/cache/abort, render states
   ├─ CalendarStrip.tsx     Mon–Sat strip (presentational)
   ├─ MeetingCard.tsx       One meeting (presentational)
   ├─ Pagination.tsx        Dot pager (presentational)
   └─ Icons.tsx             Inline SVG clock / pin / chevron (no icon font)
└─ services/
   ├─ ExchangeService.ts    EWS FindItem + CalendarView SOAP; parse; error categorization
   ├─ CacheService.ts       sessionStorage cache, per-week, TTL
   └─ WeekUtil.ts           Pure date math (Monday-based weeks) + time formatting
└─ models/IMeeting.ts       Types
```

### Data fetching & authentication (on-prem Exchange + ADFS)

- The web part calls the **EWS** endpoint directly
  (`https://mail.<domain>/EWS/Exchange.asmx`) with a SOAP `FindItem` +
  `CalendarView` request. `CalendarView` makes Exchange **expand recurring
  meetings** into individual occurrences inside the week window — one round-trip
  per week.
- Requests are sent with `credentials: 'include'`. On an ADFS / Kerberos / IWA
  intranet where SharePoint SE and Exchange share the federation realm, the
  browser performs **SSO transparently** — no tokens are handled in JavaScript
  and nothing is persisted. This is the realistic pattern for SPFx 1.4.1 on-prem;
  there is no AAD/Graph token flow available.
- Only the fields rendered are requested (`Subject`, `Start`, `End`, `Location`,
  `IsAllDayEvent`) to keep the payload minimal.

### Performance

- **Async, non-blocking:** React renders the chrome + a skeleton immediately;
  the EWS call happens after first paint, so the web part never blocks other
  web parts on the page.
- **Caching:** results are cached in `sessionStorage` per week (default 5 min
  TTL, configurable 0–60 in the property pane). Toggling back to a visited week
  is instant and issues no network call.
- **Request hygiene:** switching weeks aborts the in-flight request
  (`AbortController` where supported) and ignores stale responses via a sequence
  token.
- **Small bundle:** no `office-ui-fabric-react`, no icon fonts — icons are inline
  SVG; the dropdown is a native element.

### Error handling

`ExchangeService` categorizes failures into `auth | config | network | server`
and the UI shows an appropriate message with a **Try again** action:
- 401/403 or an ADFS HTML sign-in page returned with HTTP 200 → "session expired,
  refresh to sign in".
- Network/CORS failure → connectivity message.
- SOAP fault / non-`NoError` `ResponseCode` → server message.
- Missing EWS URL → configuration prompt (no retry).

---

## ⚠️ Build environment requirement

This solution targets **SPFx 1.4.1**, whose gulp/webpack toolchain requires
**Node.js 8.x** (and npm 5/6). It will **not** install or build on Node 10+.
The machine this was authored on runs Node 22, so the build was **not** executed
here — the source is complete and written to compile under the 1.4.1 / TypeScript
2.4.2 toolchain.

Switch to Node 8 with nvm-windows, then build. (Run the terminal **as
Administrator** — `nvm use` needs to update the version symlink.)

```powershell
nvm install 8.17.0   # already installed on this machine
nvm use 8.17.0
node -v               # -> v8.17.0
npm install -g gulp@3.9.1
npm install
gulp clean
gulp bundle --ship
gulp package-solution --ship
# switch back when done:
nvm use 22.16.0
```

The package is produced at `sharepoint/solution/upcoming-meetings.sppkg` (path in
`config/package-solution.json`).

> If you are free to use a newer SPFx version for Subscription Edition, migrating
> to SPFx 1.16+/1.18 (Node 16/18, modern build) is recommended — the component
> code here ports with only minor manifest/typing changes.

## Deploy

1. Upload `upcoming-meetings.sppkg` to the on-prem **App Catalog** site collection.
2. Trust/deploy the solution.
3. Add the **My Meetings** web part to the intranet landing page.
4. Edit the web part and set:
   - **EWS endpoint URL** — e.g. `https://mail.contoso.com/EWS/Exchange.asmx`
   - **Mailbox (View All) URL** — e.g. `https://mail.contoso.com/owa`
   - **Cache duration** — minutes (default 5; 0 = always live)

### Connectivity & auth — same-origin reverse proxy (recommended)

The web part calls EWS with the user's credentials. To avoid cross-origin/CORS
fragility, host EWS on the **same origin** as SharePoint via an IIS reverse proxy
with **Kerberos Constrained Delegation**, then set the **EWS endpoint URL** to the
proxy path (e.g. `https://intranet.contoso.com/ews/Exchange.asmx`).

➡️ **New to this?** Plain-English walkthrough (who does what):
[docs/setup-simple.md](docs/setup-simple.md)
➡️ **Full admin runbook:** [docs/exchange-proxy.md](docs/exchange-proxy.md)
(ARR + URL Rewrite, the `/ews` IIS application, Windows auth, SPNs and KCD
delegation, verification, and an ADFS/WAP alternative).

Whichever path you choose, ensure: EWS presents a **trusted TLS cert**, and the
SharePoint site is in users' **Local Intranet** zone so Integrated/ADFS auth is
silent.

## Configuration reference

| Property | Type | Default | Notes |
|---|---|---|---|
| `ewsUrl` | text | `''` | Absolute EWS `Exchange.asmx` URL. Required. |
| `mailboxUrl` | text | `''` | OWA/mailbox URL for **View All**. |
| `cacheMinutes` | slider 0–60 | `5` | Per-session, per-week cache TTL. |
