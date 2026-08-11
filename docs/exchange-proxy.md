# Same-origin EWS reverse proxy (Option A)

This runbook makes the on-prem Exchange **EWS** endpoint reachable from the
SharePoint page **on the same origin**, so the *My Meetings* web part never makes
a cross-origin call and CORS is never involved.

It is an infrastructure task (IIS + Active Directory). Nothing in the web part
code changes — you only set the **EWS endpoint URL** property to the proxy path
at the end.

> **New to this / not an admin?** Read the plain-English walkthrough first:
> [setup-simple.md](setup-simple.md). It explains the idea, who does what, and
> the exact requests to hand your server and directory admins. This document is
> the detailed reference they'll use for the exact settings.

---

## When you don't control the Exchange server

If Exchange is owned by the client (you can't edit its IIS, `web.config`, or
RBAC), this reverse-proxy design is still the right choice — and in fact the
**only** one of the two options that is possible. Here's why.

### Enabling CORS on EWS (the other option) is ruled out

CORS response headers (`Access-Control-Allow-Origin`,
`Access-Control-Allow-Credentials`, plus an anonymous `OPTIONS` preflight
handler) must be added **on the Exchange server's own IIS / EWS virtual
directory**. That is exactly the box you don't control, and a browser will not
accept a credentialed cross-origin response unless *that* server emits the
headers. No Exchange access → CORS cannot be implemented. Rule it out.

### Why the reverse proxy still works **without touching Exchange**

The proxy runs on **your** SharePoint front-end, and with **classic** Kerberos
Constrained Delegation nothing on Exchange changes:

- The `/ews` proxy application lives on the SharePoint WFE — infrastructure you
  already deploy to.
- Classic KCD is configured on the **proxy's own AD account** (its *Delegation*
  tab → "allow delegation to `HTTP/mail.contoso.com`"). It *points at* Exchange's
  SPN but writes nothing to the Exchange account or server.
- Exchange's `HTTP/mail.contoso.com` SPN and Integrated Windows Auth on EWS
  already exist by default on-prem. Exchange just receives a normal, already
  supported authenticated EWS request.

So Exchange needs **no** configuration change.

### The one dependency you can't self-serve

You need a **single Active Directory change**: a domain admin sets constrained
delegation (and confirms SPNs) on your proxy's service account. That's an **AD
ask, not an Exchange ask** — much smaller and safer to request. Two things the AD
admin must know:

- **Use *classic* KCD, not resource-based KCD.** Resource-based KCD is configured
  *on the Exchange account* (see the "modern alternative" box in Part 4b) — which
  reintroduces the exact dependency you're avoiding. Use the classic,
  proxy-side form only.
- Given ADFS, delegation will likely need **"Use any authentication protocol"**
  (protocol transition) — a slightly higher-trust setting the AD admin must
  approve.

### The exact request to hand the client's AD team

> Please grant **classic Kerberos Constrained Delegation** from the service
> account **`CONTOSO\svc-ewsproxy`** to the SPN **`HTTP/mail.contoso.com`**, with
> **protocol transition ("use any authentication protocol") enabled**. No changes
> to Exchange or its account are required. Also confirm the SPN
> `HTTP/intranet.contoso.com` is registered to `CONTOSO\svc-ewsproxy` and that no
> duplicate SPNs exist (`setspn -X`).

### If you control neither Exchange **nor** AD

Be direct with the client: **any** browser-based feature that reads a user's
mailbox needs *some* one-time cooperation from whoever owns the Exchange/AD
environment — there is no way around it. (A server-side middle tier using EWS
**Impersonation** would instead need the `ApplicationImpersonation` RBAC role
granted **on Exchange** — a *larger* ask than the AD delegation above.) Classic
KCD is the **least-invasive** request you can make: it touches only an account you
introduce, never their Exchange server.

---

## Goal & topology

The browser only ever talks to the SharePoint host. IIS forwards `/ews/*` to
Exchange and passes the signed-in user's identity through via **Kerberos
Constrained Delegation (KCD)**.

```
Browser (user, Kerberos)                Same origin
   │  POST https://intranet.contoso.com/ews/Exchange.asmx
   ▼
SharePoint WFE / IIS  ──[ARR reverse proxy]──►  https://mail.contoso.com/EWS/Exchange.asmx
   (Windows Auth + KCD: S4U2Proxy)                 (Exchange EWS, Integrated Windows Auth)
```

### Why KCD is required (the "double hop")

The browser authenticates to the **proxy** with a Kerberos ticket issued for the
proxy's SPN (`HTTP/intranet.contoso.com`). That ticket **cannot** be replayed to
Exchange — a Kerberos service ticket is bound to one service. So the proxy must
obtain a *new* ticket to `HTTP/mail.contoso.com` **on the user's behalf**. That
is exactly what Kerberos Constrained Delegation (S4U2Proxy) does. Without it you
get an anonymous/looping 401 at Exchange.

---

## Prerequisites

- [ ] You can edit IIS on the SharePoint **front-end** server(s).
- [ ] Domain admin (or delegated) rights to set SPNs and the AD *Delegation* tab.
- [ ] The SharePoint site is in users' **Local Intranet** zone (so the browser
      does Integrated auth silently).
- [ ] Exchange EWS is reachable from the WFE over HTTPS with a **trusted** cert.
- [ ] You know the identity the proxy app pool will run as — either the WFE
      **computer account** or a dedicated **domain service account**
      (e.g. `CONTOSO\svc-ewsproxy`). A dedicated service account is recommended.

> Replace `intranet.contoso.com` (SharePoint host), `mail.contoso.com` (Exchange
> host) and `CONTOSO\svc-ewsproxy` throughout with your real values.

---

## Part 1 — Install ARR + URL Rewrite (WFE)

On each SharePoint front-end server:

1. Install **URL Rewrite 2.1** and **Application Request Routing (ARR) 3.0**
   (Web Platform Installer, or the standalone MSIs).
2. In IIS Manager → server node → **Application Request Routing Cache** →
   *Server Proxy Settings* → tick **Enable proxy** → Apply.
   (This switches ARR into reverse-proxy mode so URL Rewrite rules can forward to
   an absolute URL.)

---

## Part 2 — Create the `/ews` application + rewrite rule

Keep the proxy isolated from SharePoint by hosting it as its **own IIS
application** under the SharePoint web application, so it stays same-origin but
has its own app pool and `web.config`.

1. Create a dedicated app pool, e.g. **EwsProxyPool**, .NET CLR = *No Managed
   Code*, identity = `CONTOSO\svc-ewsproxy` (or ApplicationPoolIdentity if using
   the computer account).
2. Create an empty folder, e.g. `C:\inetpub\ewsproxy`.
3. In IIS Manager → the SharePoint site (the zone users hit, port 443) →
   **Add Application**:
   - Alias: `ews`
   - Application pool: `EwsProxyPool`
   - Physical path: `C:\inetpub\ewsproxy`
4. Put this `web.config` in `C:\inetpub\ewsproxy`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
  <system.webServer>
    <rewrite>
      <rules>
        <rule name="Proxy EWS" stopProcessing="true">
          <match url="^(.*)$" />
          <action type="Rewrite"
                  url="https://mail.contoso.com/EWS/{R:1}"
                  logRewrittenUrl="true" />
        </rule>
      </rules>
      <!-- EWS returns absolute URLs in some responses; leave host rewriting off
           because we only POST SOAP and read the body. -->
    </rewrite>
    <!-- Pass the negotiated identity to the backend (see Part 3 + 4). -->
    <security>
      <authentication>
        <anonymousAuthentication enabled="false" />
        <windowsAuthentication enabled="true" useKernelMode="false">
          <providers>
            <clear />
            <add value="Negotiate" />   <!-- Kerberos -->
          </providers>
        </windowsAuthentication>
      </authentication>
    </security>
  </system.webServer>
</configuration>
```

> `useKernelMode="false"` is important when the app pool runs as a custom domain
> account doing delegation. If you keep kernel mode on, also set
> `useAppPoolCredentials="true"`.
>
> The web part calls `/ews/Exchange.asmx`, which rewrites to
> `https://mail.contoso.com/EWS/Exchange.asmx`. Same origin → **no CORS, no
> preflight**.

> **SharePoint note:** `/ews` is a plain IIS application, *not* a SharePoint
> managed path, so SharePoint ignores it. Do **not** add it via
> `New-SPManagedPath`. Verify it doesn't collide with an existing site/path.

---

## Part 3 — Windows Authentication on the proxy

Already set in the `web.config` above (Anonymous off, Windows/Negotiate on). This
makes the browser send the user's Kerberos ticket to the proxy. Confirm in
IIS Manager → `ews` app → **Authentication**:

- Anonymous Authentication = **Disabled**
- Windows Authentication = **Enabled**, provider **Negotiate** first.

---

## Part 4 — Kerberos Constrained Delegation (the core step)

### 4a. Service Principal Names (SPNs)

Verify both SPNs exist and are unique (no duplicates — duplicates break Kerberos).

```powershell
# Backend Exchange EWS SPN — usually already present on Exchange's account:
setspn -Q HTTP/mail.contoso.com

# Front-end proxy SPN — must map to the app-pool identity used by EwsProxyPool.
setspn -Q HTTP/intranet.contoso.com
```

If the proxy SPN is missing and you use a **service account**:
```powershell
setspn -S HTTP/intranet.contoso.com CONTOSO\svc-ewsproxy
```
(If the app pool runs as the **computer account**, the `HTTP/intranet...` SPN
must be on the computer account instead.)

### 4b. Configure delegation on the proxy identity

In **Active Directory Users and Computers** (enable *View → Advanced Features*):

1. Open the proxy identity object:
   - service account → user `svc-ewsproxy`, **Delegation** tab; or
   - computer account → the WFE computer object, **Delegation** tab.
2. Select **"Trust this user/computer for delegation to specified services
   only"**.
3. Authentication protocol:
   - **Use Kerberos only** — if users authenticate to SharePoint with Kerberos.
   - **Use any authentication protocol** (protocol transition) — required if the
     front-end identity arrives via **ADFS/claims** rather than a raw Kerberos
     ticket. Given your ADFS setup, you will likely need this option.
4. **Add…** → *Users or Computers* → enter the **Exchange** account that owns
   `HTTP/mail.contoso.com` → select the `HTTP` (`mail.contoso.com`) service →
   OK.

> Modern alternative (preferred where possible): **resource-based KCD**,
> configured on the *Exchange* side with PowerShell, which avoids editing the
> Delegation tab and works cross-domain:
> ```powershell
> $proxy = Get-ADUser svc-ewsproxy          # or Get-ADComputer <WFE>
> Set-ADUser -Identity <ExchangeEwsAccount> `
>   -PrincipalsAllowedToDelegateToAccount $proxy.SID  # use the object, not just SID, per your AD module
> ```

### 4c. Apply

Delegation/SPN changes need a fresh Kerberos ticket: `iisreset` on the WFE (or
recycle `EwsProxyPool`), and have the test user sign out/in or run `klist purge`.

---

## Part 5 — Point the web part at the proxy

Edit the page → *My Meetings* web part properties:

- **EWS endpoint URL** = `https://intranet.contoso.com/ews/Exchange.asmx`
- **Mailbox (View All) URL** = e.g. `https://mail.contoso.com/owa`

That's the only product-side change. Because the request is now same-origin and
carries the user's credentials transparently, no further code or CORS config is
needed.

---

## Part 6 — Verify & troubleshoot

**Quick check (browser DevTools → Network):** the `POST` to
`/ews/Exchange.asmx` should return **200** with a SOAP `FindItemResponse` body
and **no** preflight `OPTIONS` row.

**Confirm KCD actually delegated (on the WFE):**
```powershell
klist sessions
klist                 # look for a forwarded ticket to HTTP/mail.contoso.com
```
Enable IIS **Failed Request Tracing** on the `ews` app to see the auth handshake
if it misbehaves.

| Symptom | Likely cause |
|---|---|
| Repeated **401** at the backend; works only when proxy runs *as you* | KCD not configured / wrong service in Delegation tab |
| **401** even reaching the proxy | Anonymous still enabled, or SharePoint zone not Integrated/Intranet |
| Kerberos works for some users, NTLM falls back & fails | Missing/duplicate SPN; run `setspn -X` to find duplicates |
| Backend identity arrives via ADFS but KCD fails | Use **"any authentication protocol"** (protocol transition) in 4b |
| `502.3`/timeout from ARR | WFE can't reach `mail.contoso.com`, or backend cert not trusted by the WFE |
| Got an HTML sign-in page (web part shows "sign-in required") | Proxy returned the ADFS login page; fix auth so the user is silently authenticated |

---

## Alternative: ADFS Web Application Proxy (WAP)

Since you already run ADFS, you can instead publish EWS through **Web Application
Proxy** with **ADFS pre-authentication** and **KCD single sign-on** to the
Integrated-auth backend. Same end result (single trusted origin + delegated
identity); choose this if WAP is already your standard publishing path. The web
part configuration in Part 5 is identical — just point `ewsUrl` at the WAP
external URL on the SharePoint origin.

---

## Security notes

- The proxy is **constrained**: delegation is allowed *only* to
  `HTTP/mail.contoso.com`, not the whole domain.
- Run the app pool as a **dedicated least-privilege** service account, not a
  high-privilege one.
- Keep the rewrite rule scoped to the EWS path; don't turn the WFE into an open
  forward proxy.
- TLS end-to-end: browser→WFE and WFE→Exchange both over HTTPS with trusted certs.
