# Berrify

AI-powered restaurant ERP. This repository ships the **Inventory MVP**: a
multi-tenant workspace for items, suppliers, stock movements, and a live
dashboard, backed by Supabase (Postgres + Auth + RLS).

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

Demo account (created by `npm run db:seed`):

- Email: `demo@berrify.local`
- Password: `BerrifyDemo2026!`

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
| `npm run db:seed`   | Create a confirmed demo user and sample inventory.  |

## Data model

Multi-tenant by organization. Every inventory/supplier/movement row is scoped
by `org_id`. Row Level Security allows access only when the signed-in user has
a `memberships` row for that org. New auth users get a personal restaurant
workspace automatically.

Low stock is `quantity <= reorder_level`. Adjusting stock writes a
`stock_movements` row; a database trigger updates `inventory_items.quantity`.

## Cursor Cloud Agent environment

`.cursor/environment.json` installs dependencies with `npm ci` and runs
`npm run dev` on port `5173`. Migrations are **not** run on agent boot.

## License

MIT
