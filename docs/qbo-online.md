# QuickBooks Online

Kane Rum Bar stays on QuickBooks Desktop (Web Connector). Another restaurant
connects QuickBooks Online on its own card. Send uses that restaurant’s
connection only: a Desktop invoice never posts to the Online company, and an
Online invoice never queues a Web Connector BillAdd.

Berrify does not create vendors or accounts. IIF and CSV export are unchanged.
Bills are created only when a manager clicks Send.

## Connect

1. In the Intuit developer app, set the redirect URL to
   `https://berrify.app/api/qbo/callback` (or `{PUBLIC_APP_URL}/api/qbo/callback`).
   Public placeholder pages for production app onboarding live at
   `https://berrify.app/terms` and `https://berrify.app/privacy`.
2. Set Worker secrets (values stay out of the repo):

```bash
npx wrangler secret put INTUIT_CLIENT_ID
npx wrangler secret put INTUIT_CLIENT_SECRET
```

Optional: `INTUIT_ENVIRONMENT=sandbox` uses the sandbox Accounting API. The
default is production.

3. Apply the new migration (do not use `db:push`):

```bash
npm run db:apply -- 0026_quickbooks_online.sql
```

4. Open QuickBooks, pick the restaurant, and click **Connect QuickBooks Online**.
   If the Worker secrets are missing, the button explains that and shows the
   redirect URL.
5. After Intuit redirects back, Berrify stores that restaurant’s realm and
   refresh token and syncs vendors and accounts for that company only.

Review dropdowns for that restaurant use those vendors and accounts. Send
posts `POST /v3/company/{realmId}/bill` with `VendorRef` and `AccountRef` ids
and saves the QuickBooks Online Bill id on `invoices.quickbooks_txn_id`.
If the vendor or a named expense / A/P account is missing, the send fails.
Berrify does not create vendors or accounts.

A second Send for the same invoice number and vendor reuses the existing Bill
instead of posting another. Disconnect revokes the Intuit refresh token, then
clears the local tokens.

## Copy vendors and accounts into a sandbox

Berrify stores one QuickBooks Online connection per restaurant. It cannot keep
production and sandbox OAuth tokens at the same time, and ordinary Refresh only
reads the currently connected company. It never creates vendors or accounts.

For Lelas (or any restaurant) development against a sandbox company:

1. Point the Worker at the source environment (`INTUIT_ENVIRONMENT` unset or
   `production` for a live company). Connect that restaurant and wait for the
   vendor/account sync.
2. On the restaurant card, click **Export lists**. Save the JSON. The file has
   names, account types, and active flags only — no tokens or realm ids.
3. Disconnect QuickBooks Online for that restaurant.
4. Point the Worker at sandbox (`INTUIT_ENVIRONMENT=sandbox` and the sandbox
   Intuit app secrets). Connect the sandbox company.
5. Click **Import lists**, choose the saved JSON, and confirm. Import creates
   vendors and accounts whose names are missing in the sandbox. Existing names
   are left unchanged.

The Worker must use the matching Intuit API for the company you are connected
to. Do not invent production realm ids or put secrets in the repo. After import,
Refresh again if the dropdowns look stale.
