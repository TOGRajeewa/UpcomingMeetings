# My Meetings — integrating into the CBSL portal bundle

This folder contains a **standalone, framework-free build** of the My Meetings
widget written in the exact idiom of `cbsl-portal.bundle.js` (React 18 UMD,
hand-written `React.createElement`, `tw-` Tailwind classes, `CBSL.register`).
It plugs into the CBSL SP SE portal with **no SPFx build and no deployment to
Exchange or SharePoint servers** beyond copying a JS file and bumping a cache
token.

> Target repo: `TOGRajeewa/CBSL_SP_Site`, branch `Integrate-UpcomingMeetings`.
> The home page (`New_Home.aspx`) already declares the mount point:
> `<div id="my-meetings" data-react-component="MyMeetings" data-lazy="false" …>`.
> This file registers that `MyMeetings` component — nothing else in the page changes.

---

## What it does

- Reads the signed-in user's Exchange calendar for **Previous / This / Next**
  week via EWS (`FindItem` + `CalendarView`, recurrences expanded).
- Renders: title + week label, a ‹ Mon–Sun › day strip (arrows step between
  previous/this/next week), up to 3 meeting cards (title + time + location), a
  dot pager, and a **View all** button that opens the mailbox.
- Opens on **today's** meetings. Clicking a day lists that day's meetings
  (selected day = filled **maroon**, today = maroon ring); an arrow step selects
  the Monday of the new week. Day clicks filter the cached week — no extra EWS call.
- Uses the portal's semantic theme tokens (`cbsl-ink/mute/line/surface/
  surface-2/maroon`), so it follows the dark-default theme automatically.
- Caches each week in `sessionStorage` (TTL configurable) and aborts superseded
  requests — week toggles are instant and don't re-hit EWS.

The data path is the **same-origin reverse proxy** from
[`../docs/exchange-proxy.md`](../docs/exchange-proxy.md) (Option A). No
cross-origin call, no tokens in JS — ADFS/IWA SSO is transparent.

---

## Integration — pick ONE

### Option 1 (recommended): drop-in as its own script

Mirrors how `cbsl-breadcrumb.js` / `cbsl-doc-tracker.js` are loaded. **No edits
to the 300 KB bundle.**

1. Copy `cbsl-upcoming-meetings.js` to the portal repo at:
   ```
   SiteAssets/SiteComponents/js/cbsl-upcoming-meetings.js
   ```
   (It **must** live under `SiteAssets/SiteComponents/js/` so Tailwind's content
   glob picks up its `tw-` classes on the next CSS build.)

2. Add one `<script>` tag in **`Home.master`**, right after the bundle line
   (order doesn't matter — the bootstrapper queues the container until this
   registers):
   ```html
   <script type="text/javascript" src="/SiteAssets/SiteComponents/js/cbsl-portal.bundle.js?v=YYYYMMDDx" defer="defer"></script>
   <script type="text/javascript" src="/SiteAssets/SiteComponents/js/cbsl-upcoming-meetings.js?v=YYYYMMDDa" defer="defer"></script>
   ```
   (My Meetings is only on the home page, so `Home.master` is enough. Add it to
   `Inner.master` too only if you place the widget on inner pages.)

### Option 2: merge into the single bundle

The file is a self-contained IIFE, so you can paste its **entire contents**
into `cbsl-portal.bundle.js` (anywhere before the final `})(window);` is fine —
a nested IIFE is isolated). Then no extra `<script>` tag is needed; just bump the
bundle's own `?v=` token. Choose this only if you prefer a single file to ship.

---

## Configure the EWS + mailbox URLs

Three sources, in priority order:
**`data-*` on the div  ›  `CBSL.config.upcomingMeetings`  ›  `DEFAULTS` in the file.**
Pick whichever fits how you deployed:

| If you did… | Put config in… | Bundle edited? |
|---|---|---|
| Option 1 (drop-in file) and want **zero** other edits | `data-*` on the `#my-meetings` div (**A**), **or** the `DEFAULTS` block at the top of `cbsl-upcoming-meetings.js` (**C**) | No |
| Either option, prefer one config object | `CBSL.config.upcomingMeetings` in the bundle (**B**) | Yes — a small 4-line add |

> So: **yes, you can use `CBSL.config.upcomingMeetings` even with the drop-in
> file** — both scripts share `window.CBSL`, and the widget reads it at mount
> time (after the bundle has set `CBSL.config`). Just note that *adding* that key
> means editing the bundle's `CONFIG`, so it's no longer "zero bundle edits." For
> a truly untouched bundle, use **A** or **C**.

**A. On the mount div** in `New_Home.aspx` (no bundle edit needed):
```html
<div id="my-meetings" data-react-component="MyMeetings" data-lazy="false"
     data-ews-url="/ews/Exchange.asmx"
     data-mailbox-url="https://mail.cbsl.gov.lk/owa"
     data-cache-minutes="5"
     class="cbsl-skel tw-rounded-xl tw-min-h-[320px]"></div>
```

**B. In the bundle's `CONFIG`** (single source of truth, consistent with the
rest of the portal). Add to the `CONFIG` object in `cbsl-portal.bundle.js`:
```js
upcomingMeetings: {
  ewsUrl: '/ews/Exchange.asmx',              // same-origin proxy path (see docs/exchange-proxy.md)
  mailboxUrl: 'https://mail.cbsl.gov.lk/owa',
  cacheMinutes: 5
},
```

**C. In the drop-in file itself** — edit the `DEFAULTS` block near the top of
`cbsl-upcoming-meetings.js`:
```js
var DEFAULTS = {
  ewsUrl: '/ews/Exchange.asmx',
  mailboxUrl: 'https://mail.cbsl.gov.lk/owa',
  cacheMinutes: 5
};
```
This keeps all config in the one standalone file — nothing else touched.

- `ewsUrl` may be **site-relative** (`/ews/Exchange.asmx` → resolved against the
  current origin) or an **absolute** URL. Point it at the reverse proxy, not
  directly at Exchange.
- If `ewsUrl` is empty, the widget renders a friendly "not connected yet" note
  instead of erroring.

---

## Rebuild the CSS (required once)

The widget uses standard `tw-` utilities. Because Tailwind runs with JIT + the
content glob `./SiteAssets/SiteComponents/js/**/*.js`, any new classes are
generated only when you rebuild:

```bash
npm run build:css      # regenerates SiteAssets/SiteComponents/css/cbsl-portal.css
```

Then bump the `cbsl-portal.css` `?v=` token in the masters (per HANDOFFUI).

---

## Deploy checklist (per HANDOFFUI.md)

- [ ] `node --check SiteAssets/SiteComponents/js/cbsl-upcoming-meetings.js`
- [ ] Copy the JS via WebDAV to `…/SiteAssets/SiteComponents/js/`
- [ ] `npm run build:css` → copy `cbsl-portal.css` over
- [ ] Bump `?v=` tokens: the new script + `cbsl-portal.css` in `Home.master`
- [ ] **Check-in (major) + publish** the master (else non-admins get a stale copy)
- [ ] MD5-verify (`Get-FileHash`) local vs remote for every file
- [ ] Hard-refresh; confirm meetings load and week-switch works

---

## Verify quickly (browser DevTools)

- **Network:** a `POST` to `…/ews/Exchange.asmx` returns **200** + a SOAP
  `FindItemResponse` body, and there is **no** `OPTIONS` preflight (proof it's
  same-origin).
- **Elements:** the `#my-meetings` div loses `cbsl-skel` and contains the widget.
- If it shows "sign-in is required" / a login page flashed → the reverse-proxy
  auth/KCD isn't complete yet (see `docs/exchange-proxy.md`, Part 6).

---

## Notes

- No dependency on the SPFx version in this repo — that's a separate delivery
  path. This standalone build is the one that merges into the portal bundle.
- Subject/location are rendered as text nodes (React-escaped) — no XSS from
  mailbox content.
- React 15-era code is not used here; the portal ships React 18 UMD globally, so
  `ReactDOM.createRoot` is used with a fallback to legacy `ReactDOM.render`.
