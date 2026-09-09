# Berrify user guide

Berrify is a restaurant workspace for inventory, weekly scheduling, time clock, and supplier invoices. This guide covers every live screen: what it does, who can use it, and how to complete the common tasks.

Illustrated PDF (screenshots of every screen): [berrify-user-guide.pdf](berrify-user-guide.pdf).

Payroll and Analytics appear in the sidebar as **Coming soon**. They are not built yet.

---

## Sign in and accounts

### What it does

Berrify is a multi-tenant workspace. After you sign in, you work inside one restaurant organization. Your **role** decides which pages and actions you get.

| Role | Who it is | Extra access |
| --- | --- | --- |
| **Staff** | Line staff with a linked employee row | Schedule (own published shifts) and Time Clock (Clock in / Clock out). They punch on the tablet kiosk only after a manager or admin opens it. |
| **Manager** | Day-to-day operator | Dashboard, schedule editing, Time Clock attendance, inventory, invoices, and suppliers. Cannot create accounts or edit pay. |
| **Admin** | Workspace admin | Everything a manager can do, plus **Employees** (create accounts, set manager/staff access, station, and pay) and Time Clock **Settings** |

Staff cannot open Dashboard, Employees, Inventory, Invoices, Suppliers, Movements, or Kiosk. Those routes send them to Schedule.

### How to use it

1. Open Berrify and land on **Sign in**.
2. Enter email and password, then **Sign in**.
3. Use the eye icon to show or hide the password.
4. New restaurants cannot be created from this screen. An admin adds people on **Employees**.

### Forgot password

1. On **Sign in**, click **Forgot password?**
2. Enter your email and click **Send reset link**.
3. Berrify always shows the same confirmation so it does not reveal whether that email has an account.
4. Open the email, set a new password (at least 6 characters) on **Reset password**, then sign in again.
5. If the link is stale, the reset page says **This link expired. Request a new one.**

Email delivery uses the project’s existing Supabase mail settings.

**Important:** `demo@berrify.local` is an admin login used in local seed data and often has **no employee row**. That person can run the office (roster, invoices, attendance) but **cannot punch**. Use a staff seed account such as `server@berrify.local` to try Clock in / Clock out. Seed passwords live in the README, not on the sign-in screen.

### Joining an existing restaurant (staff or manager)

1. An admin adds you on **Employees**, sets App access to **Staff** or **Manager**, and shares how you will sign in.
2. You cannot create a restaurant or join from **Sign in**. Invite join from this screen is not available yet.

### Sign out

Use **Sign out** at the bottom of the left sidebar.

---

## Finding your way around

The left sidebar is always visible after sign-in.

- **Overview:** Dashboard, Schedule, Time Clock, Kiosk (staff see Schedule and Time Clock only)
- **Operations (admin / manager):** Employees (admin only), Inventory, Invoices, Suppliers, Movements
- **Coming soon (admin / manager):** Payroll, Analytics (locked)

The current page is highlighted in burgundy. The restaurant name under the page title is your organization (for example Pacifico Kitchen).

---

## Dashboard

### What it does

Dashboard is the home screen for **admins and managers**. It summarizes stock, who is on the clock, invoices waiting for review, and scheduled hours for the current week. Staff are sent to **Schedule** instead.

### How to use it

1. Open **Dashboard** (the berrify mark or the first nav item).
2. Read the four cards:
   - **Low stock** — items where on-hand is at or below the reorder level
   - **On clock** — people currently working or on break
   - **Invoices to review** — bills in `received` or `extracted` (not yet reviewed/exported)
   - **Scheduled hours** — published shift hours this calendar week, plus how many published shifts are today
3. Type in **Search** to filter the recent-activity table by title or detail.
4. Managers can click **New invoice** to jump to Invoices.
5. Use **Schedule** and **Inventory** links in the lower cards to jump into those lists.

The activity feed is built from real invoices, low-stock items, today’s shifts, and stock movements. It does not invent events.

---

## Schedule

### What it does

Schedule is the weekly staff board. Managers draft and publish shifts. Staff only see **published** shifts assigned to them, plus who else is on that day.

Shifts are either:

- **Draft** — visible to managers only; hidden from staff
- **Published** — visible to the assigned employee

Hours on the board are decimal hours for that week (`4:00–10:00` = 6 hours). Overlaps for the same employee are flagged.

### How managers use it

1. Open **Schedule**.
2. Use the arrows or **This week** to change the week. The center chip shows the date range.
3. Click **+ Add** in a cell, or **Add shift**, to create a shift. Defaults are typically 4:00–10:00 PM (open shifts 5:00–11:00 PM).
4. In the dialog set:
   - **Employee** — or leave **Open / unassigned**
   - **Station** — Server, Cook, Bartender, Host, Dish, Manager, Other
   - **Status** — Draft or Published
   - **Starts / Ends**
   - **Note** (optional)
5. Save. A warning appears if that employee already has an overlapping shift.
6. Click a shift pill to edit or delete it.
   - Burgundy pill = published
   - Gray pill = draft
7. When the week looks right, click **Publish week**. That publishes every remaining draft for the visible week.

The **Hours** column is the employee’s total hours on this week’s board.

### How staff use it

1. Open **Schedule**.
2. Page by week.
3. Each day card shows your published shifts (time, station, note).
4. If you have a shift that day, **Also on** lists coworkers published the same day.

You cannot create, edit, or publish shifts as staff.

---

## Time Clock

### What it does

Time Clock records live punches. Events are immutable (clock in, start break, end break, clock out). A live session exists only while someone is on the clock. Closed sessions become **time entries**. Problems become **exceptions**. The system never invents a clock-out.

You can only punch if:

- your login is linked to an **employee** row, and
- that employee is **Active**

### Clock (everyone with an employee row)

1. Open **Time Clock** → **Clock**.
2. Read the status: **Off clock**, **Working / Clocked in**, or **On break**.
3. Use the allowed button only:
   - Off clock → **Clock in**
   - Working → **Start break** or **Clock out**
   - On break → **End break**
4. **Recent punches** groups those events into daily rows (clock in, break, clock out).

Invalid actions stay disabled. You cannot clock in twice, or clock out while on break, without a manager force-out or a recorded missing punch.

### Who’s working (manager / admin)

Shows people currently **Working** or **On break**, with time since clock-in.

Managers and admins can **Force out**:

1. Click **Force out** on that person.
2. Type a required reason.
3. Confirm. That writes a manager clock-out. It does not invent a normal employee punch.

### Attendance (manager / admin)

Use this when someone forgot to punch.

1. Open **Attendance**.
2. Under **Record missing punch**, pick employee, event (clock in / start break / end break / clock out), date & time, and a required reason.
3. Click **Record punch**.
4. **Derived time entries** lists closed sessions: started, ended, worked time (`h:mm`), unpaid break, and status (`pending` or `exception`).

### Activity (manager / admin)

A log of clock events for the organization: when, who, event, actor (employee / manager / system), and source (web, and so on).

### Exceptions (manager / admin)

Exceptions flag attendance problems. They are **not** a timesheet approval queue.

1. Click **Reconcile open sessions** to scan for missed-in / missed-out. This only **flags**. It never writes a fake clock-out.
2. Open exceptions show **Resolve** or **Dismiss**.

Types you may see include missed in, missed out, early, late, long break, unscheduled, overlap, and a reserved `missing_employment_term` (no payroll terms yet).

### Settings (admin only)

Sets organization clock rules:

- **Timezone** (default `America/Puerto_Rico`)
- **Workweek starts** (day + time)
- **Meal breaks paid** / **Rest breaks paid**

Click **Save settings**.

### Kiosk (manager / admin)

Open **Kiosk** from the sidebar on the shared tablet. Staff do not see this item. They enter their clock PIN on that screen to punch. Leave the kiosk with the admin exit PIN.

Time Clock has no pay period, payroll export, or employee timesheet approval yet.

---

## Employees

**Admins only.**

### What it does

Employees is where admins create accounts: name, station (job), app access (manager or staff), phone, hourly rate, whether a login is linked, and active/inactive.

A roster row can exist **before** the person has an account. **Login = Linked** means `user_id` is set. **Invite pending** means they are on the roster but have not signed in with that email yet.

### How to use it

1. Open **Employees**.
2. Search the roster by name, email, or station.
3. Click **Add account**. Fill:
   - Full name (required)
   - Email (use the address they will sign in with)
   - Phone
   - Station
   - **App access** — Manager or Staff
   - Hourly rate
   - Clock PIN (optional)
   - **Active on the roster**
4. **Edit** changes the same fields. Uncheck Active to keep history but block punches and new shifts on the active board.
5. **Delete** removes the roster row after confirm.

Hourly rate is stored for the roster. Berrify does **not** run payroll from it yet.

---

## Inventory

**Admins and managers only.**

### What it does

Inventory is the item catalog and on-hand counts. Status is computed:

| Status | Meaning |
| --- | --- |
| **In stock** | On hand is above the reorder level |
| **Low stock** | On hand is greater than 0 and at or below reorder |
| **Out of stock** | On hand is 0 or less |

Quantity on an **existing** item is not edited in the item form. Use **Adjust** so every change writes a stock movement.

### How to use it

1. Open **Inventory**.
2. Search by name, SKU, or category. Filter **All categories**. Switch **All items** / **Low stock**.
3. **Add item** sets name, SKU, category, unit, unit cost, starting quantity, reorder level, and optional supplier.
4. **Edit** changes catalog fields. On-hand is read-only there.
5. **Adjust** records a movement:
   - **Purchase** — adds the amount
   - **Usage** — subtracts the amount
   - **Waste** — subtracts the amount
   - **Adjustment** — signed delta (negative allowed)
6. Add an optional note, check the resulting quantity, then **Record movement**.
7. **Delete** removes the item after confirm.

Categories: Produce, Protein, Dairy, Dry Goods, Beverages, Paper, Other.

Units: ea, lb, kg, oz, gal, qt, L, case, bag, sleeve.

---

## Suppliers

**Admins and managers only.**

### What it does

Suppliers is the vendor list used on inventory items and invoice review (QuickBooks vendor).

### How to use it

1. Open **Suppliers**.
2. Search by name, email, or phone.
3. **Add supplier** — name (required), email, phone, notes.
4. **Edit** or **Delete** from the row.

Link a supplier to an item on Inventory so the item table shows who you buy it from. On an invoice, pick the same vendor so the IIF bill uses the right QuickBooks name.

---

## Stock movements

**Admins and managers only.**

### What it does

Movements is the audit log of every inventory quantity change. Adjustments on Inventory create these rows. A database trigger updates `on hand` from the movement — you do not edit quantity in two places.

### How to use it

1. Open **Movements**.
2. Search by item name, SKU, or note.
3. Filter by reason: Purchase, Usage, Adjustment, Waste.
4. Read when it happened, the item, the signed delta (green +, red −), and the note.

This page is view-only. To add a movement, go to Inventory → **Adjust**.

---

## Invoices

**Admins and managers only.**

### What it does

Invoices turns a supplier photo (or WhatsApp forward) into a QuickBooks Desktop **Bill** on the **Expenses** tab — not one item line per SKU.

Typical flow:

1. Photograph or upload a bill.
2. Berrify runs OCR (it tries 0° / 90° / 180° / 270° and keeps the best read).
3. It extracts vendor, date, totals, SKUs, and rolls SKUs into expense accounts (food, kitchen, cleaning, beverage, tax).
4. It tries to pick **which restaurant’s books** the bill belongs to (Semilla vs Kane Rum Bar).
5. You review, then export an `.iif` (or CSV) and import it in QuickBooks Desktop.

Statuses:

| Status | Meaning |
| --- | --- |
| **received** | Photo stored; little or nothing extracted |
| **extracted** | OCR produced lines and/or a total — needs a human pass |
| **reviewed** | You saved the review without exporting |
| **exported** | You downloaded IIF or CSV |

### How to capture a bill

1. Open **Invoices**.
2. Choose:
   - **Camera** — phone or webcam capture
   - **Upload photo** — pick an image
   - **WhatsApp** — same upload, tagged as a WhatsApp forward
3. Wait for OCR. One photo can create more than one bill.
4. Filter by restaurant if you run more than one set of books.
5. Use tabs **All / Extracted / Reviewed / Exported**.

Routing (first match wins):

1. WhatsApp group name / ingest `--group` / `--restaurant`
2. Mapped sender (`--from`)
3. Caption words such as `semilla` or `kane`
4. Sold-to / ship-to on the factura (Semilla · 57 Delcasse vs Kane Rum Bar · Ashford)

Do not rely on **CAN ENTERPRISE** alone — both restaurants print it.

### How to review and export

1. Click **Review** on a row.
2. Check the photo, then set:
   - **Restaurant / QBO books**
   - **QuickBooks vendor**
   - Print name, ref no., date, due, terms
3. Fix **SKU lines** (description, shipped qty, amount, category). Add or remove lines as needed. Jose Santiago bill qty is **Desp** (shipped).
4. Check **QuickBooks expenses**. **Recalc rollup** rebuilds the Expenses tab from SKUs + tax.
5. Confirm tax, subtotal, and total.
6. Open **OCR text** if a line looks wrong.
7. Then:
   - **Save review** — keep the bill as reviewed
   - **Export Desktop IIF** — download the Bill and mark exported
   - **Export CSV** — fallback file, also marks exported

IIF Bills use A/P account `20000` and the Expenses tab only.

Known vendor terms used in extraction: Jose Santiago Inc (Net 15), Ballester Hermanos Inc (Net 30), SuperMax (due on receipt), Drouyn & Co (Net 7), Santurce Brewing Inc (Net 15), B. Fernandez & Hnos Inc (Net 30), Northwestern Selecta (Net 7).

Pink carbonless photos shot sideways usually need a human pass before export.

---

## What each role can do

| Task | Staff | Manager | Admin |
| --- | --- | --- | --- |
| Sign in / sign out | Yes | Yes | Yes |
| Dashboard | No | Yes | Yes |
| See own published shifts | Yes | Yes | Yes |
| Edit / publish the week board | No | Yes | Yes |
| Punch (if linked + active) | Yes | Yes | Yes |
| Open tablet kiosk | No | Yes | Yes |
| Who’s working | No | Yes (times + force out) | Yes |
| Record missing punch, activity, exceptions | No | Yes | Yes |
| Clock settings | No | No | Yes |
| Employees (create accounts, pay, access) | No | No | Yes |
| Inventory, suppliers, movements | No | Yes | Yes |
| Capture / review / export invoices | No | Yes | Yes |
| Payroll / Analytics | No | No | No |

---

## Typical daily paths

**Open the floor (staff)**  
Sign in → Time Clock → Clock in → work → Start break / End break → Clock out. Check Schedule for today’s published shift.

**Open the floor (manager)**  
Dashboard for low stock and coverage → Time Clock → Who’s working → Schedule if you still have drafts to publish.

**Receive a delivery**  
Inventory → find the item → **Adjust** → Purchase → amount → Record movement. Confirm it on Movements.

**A supplier texts a factura**  
Photograph it (or WhatsApp forward) → Invoices → Review restaurant and expenses → Export Desktop IIF → import in that restaurant’s QuickBooks company file.

**Someone forgot to clock out**  
Time Clock → Attendance → Record missing punch, or Exceptions → Reconcile open sessions → resolve the flag. Do not expect Berrify to invent a clock-out.

---

## What Berrify does not do yet

- Payroll, pay periods, and timesheet approvals
- Analytics
- PIN or kiosk clock
- Live QuickBooks Online OAuth or Web Connector sync (export is a file you import)
- Unofficial WhatsApp group bots (official Cloud API cannot join a normal kitchen group)

For developer setup, migrations, and seed data, see the repository `README.md`.
