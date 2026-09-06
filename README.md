# Berrify

AI-powered restaurant ERP. This repository ships **Inventory**, **Employee
scheduling**, and **supplier invoice capture**: a multi-tenant workspace for
items, stock, a weekly schedule board, and QuickBooks Desktop bills from
sideways invoice photos, backed by Supabase (Postgres + Auth + RLS).

## Stack

- React 18 + TypeScript + Vite
- Tailwind CSS v4
- React Router, TanStack Query
- Supabase (`@supabase/supabase-js`)
- Node scripts (`tsx` + `pg`) for migrations and seed

## Prerequisites

- Node.js 20+ (developed against Node 22)
- A Supabase project (URL, anon key, service role, and a Postgres connection string)

## Local setup

```bash
git clone https://github.com/ggomez-cmd/Berrify.git
cd Berrify
cp .env.example .env
# fill NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
# SUPABASE_SERVICE_ROLE_KEY, and DIRECT_URL
npm install
npm run db:push
npm run db:seed
npm run dev
```

The dev server runs at http://localhost:5173.

Demo accounts (created by `npm run db:seed`), password `BerrifyDemo2026!`:

- Manager: `demo@berrify.local`
- Staff (server): `server@berrify.local`
- Staff (cook): `cook@berrify.local`

Managers create an employee with an email. When that person signs up with the
same email, they join the restaurant as staff instead of getting a new workspace.

## Scripts

| Command             | Description                                         |
| ------------------- | --------------------------------------------------- |
| `npm run dev`       | Start the Vite dev server.                          |
| `npm run build`     | Type-check and build for production.                |
| `npm run preview`   | Preview the production build.                       |
| `npm run lint`      | Run ESLint.                                         |
| `npm run typecheck` | Type-check without emitting.                        |
| `npm test`          | Run Vitest unit tests.                              |
| `npm run db:push`   | Apply `supabase/migrations/*.sql` via `DIRECT_URL`. |
| `npm run verify:db` | Assert tables, RLS, and policies exist.             |
| `npm run db:seed`   | Create demo users, inventory, roster, shifts, and a Jose Santiago bill. |
| `npm run whatsapp:ingest` | File + caption → same invoice pipeline (Business inbox). |

## Data model

Multi-tenant by organization. Inventory and scheduling rows are scoped by
`org_id`. Row Level Security allows access only when the signed-in user has a
`memberships` row for that org.

- Low stock is `quantity <= reorder_level`. Adjusting stock writes a
  `stock_movements` row; a database trigger updates `inventory_items.quantity`.
- Shifts may be `draft` or `published`. Staff can only read published shifts.
  Owners and managers can edit the roster and the week board.
- `employees.user_id` is optional. Roster rows can exist before the person has
  a login.
- Invoices store raw SKU lines plus rolled-up `invoice_expense_lines` (Food,
  Kitchen, Cleaning, Tax). Export is a QuickBooks Desktop IIF Bill on the
  Expenses tab (A/P `20000`), not one item line per SKU.

## Invoices → QuickBooks Desktop Bill

1. Photograph a supplier invoice — Jose Santiago, Ballester Hermanos, SuperMax,
   Drouyn, Santurce Brewing, B. Fernández, Northwestern Selecta, or a clipped
   pair (often rotated 90°) — or import a WhatsApp forward.
2. Open **Invoices**, review the photo, SKUs (bill qty = **Desp** on Jose
   Santiago), and the proposed Expenses tab. One photo can create two bills.
3. Export **Desktop IIF** (or CSV fallback) and import the Bill in QuickBooks
   Desktop. Vendors and terms: Jose Santiago Inc (Net 15), Ballester Hermanos
   Inc (Net 30), SuperMax (due on receipt), Drouyn & Co (Net 7), Santurce
   Brewing Inc (Net 15), B. Fernandez & Hnos Inc (Net 30), Northwestern Selecta
   (Net 7). Expenses tab only — food, beverage, kitchen, cleaning, tax.

The seed includes the Jose Santiago `$1,155.59` example (ref `6512495`) with
expense splits `$32.95` tax / `$176.55` kitchen / `$30.34` Fabuloso /
`$915.75` food. Other fixtures: Ballester `$757.56` food, SuperMax `$48.44`,
Drouyn `$61.50`, Santurce `$78.05` (beer + tax), Fernández `$182.86` (rum +
tax), Northwestern `$446.27`.

WhatsApp: official Cloud API cannot join a normal group. Forward the photo to
the restaurant Business number, then run:

```bash
npm run whatsapp:ingest -- --file ./factura.jpg --from +17875550100
# or, when you already have OCR / caption text:
npm run whatsapp:ingest -- --file ./ocr.txt --caption "Forwarded factura"
```

The webhook JSON shape is documented at the top of
`scripts/whatsapp-ingest.ts`. Live QBO Desktop Web Connector, QBO Online OAuth,
and unofficial group bots are out of scope. OCR runs in the browser (and in
`whatsapp:ingest` for image files) with `tesseract.js` — it tries 0/90/180/270
and keeps the highest confidence. Pink carbonless photos that were shot
sideways usually need a human pass in Review before you export.

## Cursor Cloud Agent environment

`.cursor/environment.json` installs dependencies with `npm ci` and runs
`npm run dev` on port `5173`. Migrations are **not** run on agent boot.

## License

MIT
