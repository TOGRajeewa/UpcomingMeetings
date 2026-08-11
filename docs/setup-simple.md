# Simple setup guide (plain English)

New to this? Start here. This explains Option A in everyday language and tells
you **who** does **what**. The deep technical version with every setting is in
[exchange-proxy.md](exchange-proxy.md) — hand that to your admins when they need
the exact clicks.

---

## The idea, as a picture

Think of two office buildings:

- **SharePoint building** — where your web page (and the My Meetings web part)
  lives.
- **Mail building (Exchange)** — where everyone's calendar is kept.

A browser security rule says a visitor in one building **isn't allowed to walk
over to a different building** and grab data directly. That rule is why a direct
call to Exchange fails.

**The fix:** we put a **forwarding desk** inside the SharePoint building. The web
part hands its request to the desk. The desk walks over to the Mail building,
says *"I'm fetching this on behalf of Jane"*, gets Jane's meetings, and hands them
back. To the browser it all looks like it stayed in one building — so the
security rule is happy.

- The "forwarding desk" = a **reverse proxy** (a small piece of IIS config).
- "on behalf of Jane" = **delegation** (one permission switch an admin turns on).

That's the whole concept. The rest is just turning those two things on.

---

## Who you need

You will likely need help for two of the steps. That's normal — these touch the
server and the company directory.

| Role | Who that usually is | What they do here |
|---|---|---|
| **You** | The person deploying the web part | Deploy the `.sppkg`, set the web part's settings (Steps 1 & 6). Follow along on the rest. |
| **Windows Server admin** | Whoever can log into the SharePoint server | Installs 2 add-ons and creates the forwarding desk (Steps 3–4). |
| **Active Directory (domain) admin** | Whoever manages user/computer accounts in the company | Turns on the "on behalf of" permission (Step 5). |

If that's all one team, great. If not, this guide gives you the **exact words**
to send each person.

---

## Before you start: collect 3 things

Write these down — every step reuses them. (Examples in brackets; replace with
your real values.)

1. **SharePoint address** — where the page lives.
   `[ https://intranet.contoso.com ]`
2. **Exchange/EWS address** — your mail server's web-services URL. It almost
   always ends in `/EWS/Exchange.asmx`.
   `[ https://mail.contoso.com/EWS/Exchange.asmx ]`
3. **Mailbox (webmail) address** — for the "View all" button.
   `[ https://mail.contoso.com/owa ]`

> Not sure of #2? Ask your mail admin for "the EWS URL", or try opening
> `https://mail.<yourcompany>/EWS/Exchange.asmx` in a browser — if it asks you to
> sign in and then shows XML, that's it.

---

## Step 1 — Put the web part on the page (you)

1. Build and upload the solution package (`upcoming-meetings.sppkg`) to your
   SharePoint **App Catalog**, then add the **My Meetings** web part to the page.
   (Build instructions are in the main [README](../README.md).)
2. For now, leave the settings empty — we'll fill them in at Step 6, after the
   plumbing is ready.

✅ **Done when:** the web part appears on the page (it will show a "not connected
yet" message — that's expected until Step 6).

---

## Step 2 — Create a helper account (Active Directory admin)

The forwarding desk needs its own identity — a dedicated login it runs as. This
keeps things secure and easy to manage.

**Send your AD admin this:**

> Please create a standard service account, e.g. **`CONTOSO\svc-ewsproxy`**, with
> a strong non-expiring password. It needs no special group memberships. It will
> run an IIS app pool and be granted constrained delegation later (Step 5).

✅ **Done when:** you have the account name and password.

---

## Step 3 — Install two free add-ons (Windows Server admin)

On the SharePoint server, the admin installs two official Microsoft components
that make forwarding possible:

- **URL Rewrite**
- **Application Request Routing (ARR)**

Easiest way: install **Web Platform Installer** from Microsoft, search for each
by name, and click Install. Then, in **IIS Manager**, open **Application Request
Routing Cache → Server Proxy Settings**, tick **Enable proxy**, and click Apply.

✅ **Done when:** IIS Manager shows an "Application Request Routing" icon and the
"Enable proxy" box is ticked.

---

## Step 4 — Build the forwarding desk (Windows Server admin)

This is the reverse proxy. Full click-by-click steps and the ready-made config
file are in [exchange-proxy.md → Part 2 and Part 3](exchange-proxy.md#part-2--create-the-ews-application--rewrite-rule).
In short, the admin:

1. Creates a small app pool (called e.g. **EwsProxyPool**) that runs as the
   `svc-ewsproxy` account from Step 2.
2. Adds an application named **`ews`** under the SharePoint site.
3. Drops in the provided `web.config` (copy-paste from the detailed doc). This
   does two things:
   - forwards anything sent to `.../ews/...` over to your Exchange address, and
   - requires the visitor to be signed in (so we know *who* to fetch for).

After this, the address `https://intranet.contoso.com/ews/Exchange.asmx` becomes
a same-building doorway to Exchange.

✅ **Done when:** opening `https://intranet.contoso.com/ews/Exchange.asmx` in a
browser prompts sign-in and then shows XML (it may show an error page — that's
fine; it proves the forwarding reaches Exchange).

---

## Step 5 — Turn on "fetch on behalf of the user" (Active Directory admin)

This is the one permission that makes the desk able to act *as the signed-in
user* instead of as itself. It's called **Kerberos Constrained Delegation**. It's
a switch in Active Directory — **nothing on the Exchange server changes.**

**Send your AD admin this exact request:**

> Please grant **classic Kerberos Constrained Delegation** from the service
> account **`CONTOSO\svc-ewsproxy`** to the service **`HTTP/mail.contoso.com`**,
> with **"Use any authentication protocol" (protocol transition) enabled** — we
> authenticate users via ADFS. No changes to Exchange or its account are needed.
>
> Also please confirm the name **`HTTP/intranet.contoso.com`** is registered to
> `CONTOSO\svc-ewsproxy`, and that there are no duplicate names
> (`setspn -X` should report none). Details/commands:
> exchange-proxy.md → Part 4.

> ⚠️ Ask specifically for **classic** delegation (set on our `svc-ewsproxy`
> account), **not** "resource-based" delegation — resource-based is set on the
> Exchange account, which we're intentionally avoiding.

✅ **Done when:** the AD admin confirms delegation is set and the names check out.
(After this, have them run `iisreset` on the SharePoint server.)

---

## Step 6 — Point the web part at the desk and test (you)

1. Edit the page → open the **My Meetings** web part properties.
2. Fill in:
   - **EWS endpoint URL** → `https://intranet.contoso.com/ews/Exchange.asmx`
     (your SharePoint address + `/ews/Exchange.asmx` — **not** the mail address)
   - **Mailbox (View All) URL** → `https://mail.contoso.com/owa`
   - **Cache duration** → leave at `5`
3. Save and publish the page.

✅ **Done when:** the web part shows your real meetings for "This Week", and
switching to Previous/Next week updates the list. 🎉

---

## If it doesn't work

Match what you see to the likely cause. The detailed fixes are in
[exchange-proxy.md → Part 6](exchange-proxy.md#part-6--verify--troubleshoot).

| What you see | Most likely cause | Who fixes it |
|---|---|---|
| "This web part isn't connected yet" | The EWS endpoint URL is blank | You (Step 6) |
| "Sign-in is required" / a login page flashes | Delegation not on yet, or ADFS needs "any auth protocol" | AD admin (Step 5) |
| "Unable to reach the Exchange server" | The server can't get to the mail address, or a certificate warning | Server admin (Steps 3–4) |
| Loads for some people but not others | A naming (SPN) duplicate/mismatch | AD admin (`setspn -X`) |
| "You don't have permission…" | Signed-in user genuinely lacks calendar access | Mail admin |

---

## The short version (checklist)

- [ ] **Step 1** — You: add the web part to the page.
- [ ] **Step 2** — AD admin: create `svc-ewsproxy` account.
- [ ] **Step 3** — Server admin: install URL Rewrite + ARR, enable proxy.
- [ ] **Step 4** — Server admin: create the `/ews` forwarding app.
- [ ] **Step 5** — AD admin: turn on classic delegation to `HTTP/mail.contoso.com`.
- [ ] **Step 6** — You: set the web part's EWS URL to `.../ews/Exchange.asmx` and test.
