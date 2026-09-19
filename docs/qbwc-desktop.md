# QuickBooks Desktop Web Connector

Berrify exposes a SOAP service for Intuit QuickBooks Web Connector (QBWC) at
`https://berrify.app/api/qbwc`. QBWC on Windows **pulls** from Berrify. Berrify
never opens a connection to the accounting PC.

This first release only runs a read-only `CompanyQueryRq`. It does **not** post
Bills. Invoice export remains Desktop IIF on the Invoices page.

## Windows setup

1. On the QuickBooks PC, open the company `.QBW` as **Admin** (single-user is
   simplest for the first authorize).
2. In Berrify, sign in as a manager and open **QuickBooks**.
3. Choose **Shared company file** or a restaurant card, then **Connect QuickBooks Desktop**.
4. Copy the **one-time password**. Berrify stores only a hash and will not show
   it again (use **Regenerate password** if you lose it).
5. **Download Berrify.qwc**. OwnerID and FileID stay stable for that connection.
6. Open **QuickBooks Web Connector** and **Add an application**. Select `Berrify.qwc`.
7. Authorize the application in QuickBooks when prompted (Yes, always / Admin).
8. In QBWC, paste the one-time password for the Berrify username.
9. Check the Berrify row and click **Update Selected**.
10. In Berrify, the card should move from **Waiting for QuickBooks** to
    **Connected** after the company query succeeds. Then you may turn on
    Auto-Run in QBWC if you want periodic polls.

Scheduler minutes are included in a new `.qwc` download only after the first
successful company query. Re-download does not change OwnerID or FileID.

## Check the endpoint

`GET https://berrify.app/api/qbwc` returns a short `Berrify QBWC service` body.
`POST` is SOAP 1.1 (`text/xml`), not JSON.

## Troubleshooting

### Authentication (nvu)

- Username in QBWC must match the Berrify connection username.
- Password must be the one-time value from Connect or Regenerate. Old passwords
  stop working after rotate or revoke.
- The connection must be **active**. Revoke disables the username.

### URL / application

- AppURL must be `https://berrify.app/api/qbwc` (HTTPS).
- Do not point QBWC at `/api/health` or a REST JSON path.
- After a Worker deploy, retry **Update Selected**.

### TLS / certificate

- QBWC requires a trusted public HTTPS certificate. `berrify.app` is the
  production host.
- Local `http://localhost` Web Connector setups are not supported in this
  foundation.

### QuickBooks file

- Leave **company file** empty in Berrify to use the `.QBW` that is already
  open.
- If you set a path, it must be reachable on the Windows machine.

### Status stays Waiting or Error

- Confirm QuickBooks was open and the app authorized.
- Check Berrify **last error** on the card (QB status message).
- `GET` the endpoint from the Windows PC’s browser to confirm TLS and DNS.

## What is not included

- No `BillAddRq` and no automatic Bills.
- Do not treat a **Connected** company query as proof that invoices will post.
