# Berrify design guide

Light operational UI for a restaurant ERP. Page canvas is paper, panels are white, text is ink, and wine is the only brand accent. Follow the classes and components below. Do not invent a second palette, a dark theme, or a new typeface.

Source of truth for colour and the sans stack: `@theme` in `src/index.css`. Tailwind v4 is loaded from that file via `@tailwindcss/vite` (`vite.config.ts`). There is no `tailwind.config`.

## Token rule

No hardcoded colours, fonts, radii, shadows, or one-off sizes in components (`bg-[#…]`, `text-[Npx]`, `shadow-[…]`, raw `font-family`). Use the tokens and utilities in this guide.

If a screen needs a value that is not here, add it to `@theme` in `src/index.css` and to this file in the same change, then use the generated utility (`bg-wine`, `text-ink`, `border-line`, `font-sans`). Do not paste a hex or an arbitrary class into a feature file first.

Spacing, type size, and radius utilities below are Tailwind’s defaults. Prefer those named steps. Do not add a parallel scale.

## Colour

Light only. `src/index.css` has no `dark:` theme. Do not add one.

| Token | Hex | Role | Utilities |
| --- | --- | --- | --- |
| `paper` | `#f4f5f7` | App background, hover fill, inset wells | `bg-paper` |
| `white` | `#ffffff` | Cards, tables, dialogs, inputs, sidebar | `bg-white`, `text-white` |
| `ink` | `#111827` | Body and headings | `text-ink` |
| `muted` | `#6b7280` | Secondary text, labels, placeholders | `text-muted` |
| `line` | `#e5e7eb` | Hairline borders and dividers | `border-line` |
| `wine` | `#7b1924` | Primary button, link, active nav, focus | `bg-wine`, `text-wine`, `border-wine` |
| `wine-deep` | `#5c0201` | Primary hover | `hover:bg-wine-deep` |
| `navy` | `#0b1b3a` | Scrim only (`bg-navy/40`) | `bg-navy` |
| `ok` | `#16a34a` | Success | `text-ok`, `bg-ok` |
| `warn` | `#d97706` | Warning | `text-warn`, `bg-warn` |
| `danger` | `#dc2626` | Error | `text-danger`, `bg-danger` |
| `sky` | `#0284c7` | Info | `text-sky`, `bg-sky` |

Tints used throughout: `/5`, `/10`, `/15`, `/20`, `/25`, `/30`, `/40`, `/70`, `/75`. Example: active nav is `bg-wine/10 text-wine`; error button is `bg-danger/10 text-danger border-danger/25`.

`body` sets `background: var(--color-paper)`, `color: var(--color-ink)`, and `font-family: var(--font-sans)`.

### Leftover aliases — do not use

`src/index.css` keeps old dark-theme names so existing classes still resolve. They duplicate the light tokens. New UI uses the names in the table above.

| Alias | Same as |
| --- | --- |
| `fog` | `ink` |
| `mist` | `muted` |
| `berry` | `wine` |
| `plum` | `wine-deep` |
| `ink-2` | white |
| `ink-3` | `paper` |

### Variants to consolidate

- Table headers use hardcoded `bg-[#f8f8fa]` in `src/components/ui/table.tsx` and `src/features/schedule/SchedulePage.tsx`. Dominant surface is `bg-white` on `bg-paper`. New headers use `bg-paper`.
- Neutral badges use Tailwind slate (`bg-slate-100 text-slate-600 border-slate-200`, dot `bg-slate-400`) in `src/components/ui/badge.tsx`. The off-clock dot uses `bg-slate-300` in `src/features/time-clock/TimeClockPage.tsx`. New neutral chrome uses `bg-paper text-muted border-line` and `bg-muted` for the dot.
- Dialog titles are `text-navy` (`src/components/ui/dialog.tsx`). Page titles are `text-ink`. New headings use `text-ink`. Keep `navy` for scrims.
- `ok`, `warn`, and `sky` as small text on white fail WCAG AA (about 3.3:1, 3.2:1, and 4.1:1). `danger` on white is borderline. `muted` on `paper` is about 4.4:1. See Accessibility. Do not add more raw status-coloured sentences; use `Badge` or ink text on a tinted banner.

## Type

Family: Inter, loaded in `index.html` at 400, 500, 600, 700, then `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`. Token: `--font-sans`. Utility: `font-sans` (already the body default).

Weights in the UI: 400 body, `font-medium` (500) for labels, nav, badges, table headers, and links, `font-semibold` (600) for buttons, page titles, KPI values, and primary row text. 700 is loaded and unused. Do not add `font-bold`.

`font-mono` is the browser monospace, used only for credentials and file paths (QuickBooks). It is not a brand font.

| Use | Classes | Size / line height |
| --- | --- | --- |
| Page title, KPI value | `text-2xl font-semibold tracking-tight text-ink` | 24px / 32px |
| Mobile shell title | `text-base font-semibold tracking-tight text-ink` | 16px / 24px |
| Section title | `text-base font-semibold tracking-tight` or `font-semibold` | 16px / 24px |
| Dialog title | `text-lg font-semibold` (today `text-navy`; new work `text-ink`) | 18px / 28px |
| Body, buttons, inputs, table cells, errors | `text-sm` | 14px / 20px |
| Legal prose | `text-sm leading-6` | 14px / 24px |
| Labels, meta, badge | `text-xs font-medium` | 12px / 16px |
| Eyebrow | `text-[11px] font-medium uppercase tracking-[0.2em] text-muted` | 11px |

Headings that are `text-2xl` or `text-lg` also use `tracking-tight`. Kiosk clock and name use `text-3xl font-semibold tracking-tight` (`src/features/kiosk/KioskPage.tsx`). That size stays on the kiosk. App pages stop at `text-2xl`.

Sidebar group labels are the smaller variant: `text-[10px] font-medium uppercase tracking-[0.16em] text-muted` in `src/components/layout/Sidebar.tsx`. New eyebrows copy the 11px / `0.2em` line, not a third size.

Icons are `lucide-react`: `size-4` beside labels and in nav, `size-5` in the menu button and KPI tiles, `size-6` on the PIN pad.

## Spacing

Tailwind’s 4px grid (`--spacing: 0.25rem`). Steps the UI actually uses:

| Step | px | Where |
| --- | --- | --- |
| `0.5` | 2 | Nav item stack (`gap-0.5`) |
| `1` | 4 | Inline table actions (`gap-1`) |
| `1.5` | 6 | Badge contents, tight form grids |
| `2` | 8 | Toolbars, form fields, dialog button rows |
| `2.5` | 10 | Nav icon gap |
| `3` | 12 | Header, PIN pad, dialog forms (`gap-3`, `px-3 py-2`) |
| `4` | 16 | Card grids, page sections (`gap-4`, `mb-4`) |
| `5` | 20 | Page stack (`space-y-5`), card and dialog padding (`p-5`) |
| `6` | 24 | Auth card padding, desktop main (`md:py-6`, `md:px-8` is 32px) |
| `8` | 32 | Auth card `sm:p-8` |

Page toolbar: `mb-4 flex flex-wrap items-center gap-2 md:flex-nowrap`. Primary action sits at `ml-auto` and is `w-full sm:w-auto`.

Table cells: `px-4 py-3`. Empty table cell: `py-10 text-center text-muted`.

Shell padding: main is `px-4 py-4 md:px-8 md:py-6`, with `pb-[max(1rem,env(safe-area-inset-bottom))]`. Mobile header uses `pt-[max(0.75rem,env(safe-area-inset-top))]`.

## Radius and shadow

| Utility | px | Use |
| --- | --- | --- |
| `rounded-lg` | 8 | Icon buttons, small chips, photo caption |
| `rounded-xl` | 12 | Buttons, inputs, nav rows, banners, inset media |
| `rounded-2xl` | 16 | Cards, dialogs, tables, auth cards |
| `rounded-full` | — | Badges, avatars, KPI icon wells, nav active bar |
| `rounded-3xl` | 24 | Kiosk panels only (`KioskPage.tsx`). New cards stay `rounded-2xl`. |

Shadows: `shadow-sm` on cards, tables, primary buttons, and PIN keys. `shadow-xl` on dialogs. Nothing heavier. The schedule sticky column uses a one-off `shadow-[4px_0_8px_-6px_rgba(15,23,42,0.25)]`. Do not copy it. If a sticky edge needs a shadow, add a token first.

## Components

Reuse `src/components/ui/*` and `src/components/layout/*`. Match their states instead of restyling per page.

### Button — `src/components/ui/button.tsx`

Base: `inline-flex items-center justify-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold transition`. Disabled: `disabled:cursor-not-allowed disabled:opacity-50`.

| Variant | Classes |
| --- | --- |
| `primary` (default) | `bg-wine text-white shadow-sm hover:bg-wine-deep` |
| `ghost` | `bg-white border border-line text-ink hover:bg-paper` |
| `outline` | `bg-white border border-wine/30 text-wine hover:bg-wine/5` |
| `danger` | `bg-danger/10 text-danger border border-danger/25 hover:bg-danger/15` |
| `subtle` | `bg-transparent text-muted hover:text-ink hover:bg-paper` |

One primary button per toolbar. Row actions (Edit, Delete, Adjust) are `subtle`. Destructive confirms in the product today use `window.confirm`, not a styled danger button, except where `variant="danger"` is already chosen.

Busy label replaces the verb with an ellipsis (`Working…`, `Publishing…`). Disable the button while busy.

PIN keys (`src/features/kiosk/PinPad.tsx`) are separate: `h-16 rounded-2xl`, white with `border-line` or `bg-wine`, `shadow-sm`, same disabled treatment.

### Input — `src/components/ui/input.tsx`

`Input`, `Textarea`, `Select` share `fieldClass`:

`w-full rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink outline-none placeholder:text-muted/70 focus:border-wine`

Textarea adds `min-h-24`. Search (`src/components/ui/search-input.tsx`) is an `Input` with a `size-4` lucide icon at `left-3` and `pl-9`. Width: `w-full md:w-72`.

Label (`src/components/ui/label.tsx`): `mb-1.5 block text-xs font-medium text-muted`. Prefer `Field` so the label is wired with `htmlFor`. Placeholder is not a label.

### Card — `src/components/ui/card.tsx`

`rounded-2xl border border-line bg-white p-5 shadow-sm`.

KPI (`src/components/ui/kpi-card.tsx`): icon well `grid size-10 place-items-center rounded-full` at `bg-{tone}/10 text-{tone}` where tone is `wine`, `ok`, `warn`, or `sky`. Title `mt-4 text-xs font-medium text-muted`. Value `mt-1 text-2xl font-semibold tracking-tight text-ink`. Hint `mt-1 text-xs text-muted`.

Callout on a card (one-time secret, warning): `border-wine/30 bg-wine/5` or `rounded-xl border border-warn/30 bg-warn/10 px-3 py-2 text-sm`.

### List and table row

Tables (`src/components/ui/table.tsx`): wrapper `overflow-x-auto rounded-2xl border border-line bg-white shadow-sm`. Table `w-full min-w-[720px] border-collapse text-left text-sm`. Header `text-xs font-medium uppercase tracking-wide text-muted` (background: see the `#f8f8fa` note). Cell `border-t border-line px-4 py-3`.

Row hover: `hover:bg-paper` (dashboard activity uses `hover:bg-paper/70`). Primary text `font-medium`. Secondary line `text-xs text-muted`. Money and names that should stand out: `font-semibold`.

List inside a card: `ul` with `space-y-2`, each row `flex items-center justify-between gap-3 text-sm`, name `font-medium`, meta `text-muted`, long names `min-w-0 truncate`.

Avatar (`src/components/ui/avatar.tsx`): `size-9 rounded-full bg-wine/10 text-xs font-semibold text-wine`. Kiosk profile overrides to `size-20 text-xl`.

Badge (`src/components/ui/badge.tsx`): `inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium`. Optional `size-1.5` dot.

| Tone | Surface |
| --- | --- |
| `ok` | `bg-ok/10 text-ok border-ok/20` |
| `warn` | `bg-warn/10 text-warn border-warn/25` |
| `danger` | `bg-danger/10 text-danger border-danger/20` |
| `info` | `bg-sky/10 text-sky border-sky/20` |
| `neutral` | slate today; new work `bg-paper text-muted border-line` |

### Tabs — `src/components/ui/page-tabs.tsx`

Underline tabs, not pills. Container `flex gap-1 overflow-x-auto border-b border-line`. Tab `border-b-2 px-3 py-2 text-sm font-medium`. Active: `border-wine text-wine`. Inactive: `border-transparent text-muted hover:text-ink`.

### Modal, sheet, lightbox

There is no bottom sheet. Centered dialog: `src/components/ui/dialog.tsx` (Radix).

- Scrim: `fixed inset-0 z-40 bg-navy/40 backdrop-blur-sm`. Mobile nav scrim is the same colour without blur.
- Panel: `z-50 w-[min(560px,calc(100vw-1.5rem))] max-h-[min(92vh,calc(100dvh-1.5rem))] overflow-y-auto rounded-2xl border border-line bg-white p-5 shadow-xl sm:p-6`.
- Title row: `mb-4 flex items-start justify-between gap-3`. Description `mt-1 text-sm text-muted`, or `sr-only` when there is no description.
- Close: `Button variant="subtle"` with `aria-label="Close"`.
- Footer: `mt-5 flex flex-wrap justify-end gap-2`.
- Wide review dialog overrides width to `w-[min(1100px,calc(100vw-1.5rem))]`.

Mobile nav is a drawer, not a sheet: `src/components/layout/AppShell.tsx`, `fixed inset-y-0 left-0 z-50 w-60 … transition-transform duration-200 ease-out`, closed with `-translate-x-full`. Escape and route change close it. Body scroll locks while open.

Photo lightbox (`src/features/invoices/InvoicePhotoLightbox.tsx`): full-viewport `z-[80]`, scrim `bg-navy/40`, controls are `Button variant="ghost"` with `bg-white`.

Kiosk exit is an in-page panel on `bg-paper/90`, card `max-w-sm rounded-3xl`. Do not reuse that radius outside the kiosk.

### Nav — `src/components/layout/Sidebar.tsx`, `AppShell.tsx`

Sidebar `w-60 border-r border-line bg-white px-3 py-5`. Brand mark is `text-wine` (`src/components/ui/brand-mark.tsx`, mask of `/berrify-wordmark.svg`).

Nav link: `rounded-xl px-3 py-2 text-sm font-medium text-ink/75 hover:bg-paper hover:text-ink`. Active: `bg-wine/10 text-wine` plus a `w-[3px] rounded-full bg-wine` bar on the left. Disabled “Coming soon” rows: `cursor-not-allowed text-muted/70` with a lock icon.

Shell: `flex min-h-dvh bg-paper text-ink`. Sidebar `sticky top-0 hidden md:flex`. Below `md`, a sticky `z-30` white header with menu, truncated title, and sign out.

Sign out (`SignOutButton.tsx`): `rounded-xl px-3 py-2 text-sm font-medium text-muted hover:bg-paper hover:text-ink`.

### Empty, loading, error

Plain text. No spinners or skeletons in the app today.

- Loading: `text-sm text-muted`, sentence ending in `…` (`Loading inventory…`). Full-screen auth wait: `grid min-h-screen place-items-center text-muted` (`src/auth/ProtectedRoute.tsx`).
- Empty table: one cell, `colSpan` set, `py-10 text-center text-muted` (`No items match.`).
- Empty card: `text-sm text-muted` inside `Card` (`No recent activity yet.`).
- Error: `text-sm text-danger` with the message. Place it above the table or under the field (`mb-3` / `mt-3`).
- Success: `text-sm text-ok` (`Saved.`).
- Warning banner: `rounded-xl border border-warn/30 bg-warn/10 px-3 py-2 text-sm text-warn`. New banners: keep the tint and border, put the sentence in `text-ink` so it meets contrast.

## Layout and responsive

Breakpoints in use (Tailwind defaults): `sm` 640px, `md` 768px, `lg` 1024px, `xl` 1280px. The shell switches at `md`.

- Below `md`: hidden sidebar, drawer, header title `text-base`, main `px-4 py-4`, toolbars wrap, primary buttons full width until `sm`.
- `md` and up: fixed sidebar, page title `text-2xl` inside main, main `px-8 py-6`, search at `md:w-72`, toolbars `md:flex-nowrap`.
- Grids: KPI `grid gap-4 sm:grid-cols-2 xl:grid-cols-4`. Two-up sections `grid gap-4 lg:grid-cols-2`. Forms in dialogs often `grid grid-cols-2 gap-3`; dense line editors collapse with `grid-cols-1 sm:grid-cols-12`.
- Max widths: auth `max-w-md`, kiosk column `max-w-xl`, legal `max-w-2xl`, intro copy `max-w-2xl` or `max-w-3xl`. The app shell has no extra content max-width; pages fill the main column. Keep `min-w-0` on flex children that truncate.
- Tables scroll inside the rounded wrapper (`min-w-[720px]`, schedule `min-w-[1080px]`). Do not shrink the page to fit a wide table.
- Z-index: header `z-30`, scrim `z-40`, drawer and dialog `z-50`, lightbox `z-[80]`.

Auth and legal pages are outside the shell: `min-h-screen bg-paper`, centered column, card `rounded-2xl border border-line bg-white p-6 shadow-sm sm:p-8`. Eyebrow under the wordmark: `Restaurant ERP`.

## Accessibility

- Contrast: body text is `text-ink` on `bg-white` or `bg-paper`. Wine on white is about 10:1. `muted` on white clears AA for `text-sm`; `muted` on `paper` does not. Status colours `ok`, `warn`, and `sky` fail AA as text on white. Use them for fills, borders, and badge dots. Put new status sentences in `text-ink`. Do not add a darker hex in a component; add a token here and in `@theme` first if a coloured label must itself meet 4.5:1.
- Focus: inputs show focus by `focus:border-wine` and currently clear the outline. Dialog content uses `focus:outline-none` because Radix moves focus inside. Every new control needs a visible focus state. Do not add `outline-none` without a replacement (`focus:border-wine` or `focus-visible:ring-2 focus-visible:ring-wine`). Icon-only buttons need `aria-label`.
- Touch: PIN keys are `h-16`. App buttons are `py-2` (shorter than 44px). Do not make those smaller. New icon buttons, drawer controls, and primary actions on viewports below `md` are at least 44×44 (`min-h-11 min-w-11`).
- Labels: visible `Label` / `Field`, or `aria-label` when the caption is already on screen (search, email). Decorative icons `aria-hidden`. Dialogs always have a title; description is visible or `sr-only`.
- Motion: buttons use `transition`. The drawer uses `duration-200 ease-out`. New motion must respect `prefers-reduced-motion: reduce` (no translate animation). Do not add a motion library.

## Do

- Compose pages from `Button`, `Input`, `Select`, `Textarea`, `Field`, `Card`, `KpiCard`, `Table`, `Badge`, `PageTabs`, `Dialog`, `SearchInput`, `Avatar`.
- One wine primary action per view. Everything else is `ghost`, `outline`, or `subtle`.
- Page background `bg-paper`, panels `bg-white`, borders `border-line`, secondary copy `text-muted`.
- Truncate with `min-w-0 truncate`. Let wide tables scroll.
- Copy loading, empty, and error as `text-sm` lines in the existing colours.

## Don't

- Don't hardcode a colour, font, radius, or shadow. Add the token to `src/index.css` and this file first.
- Don't introduce a dark theme, a second accent, `font-bold`, or `rounded-3xl` outside the kiosk.
- Don't use `fog`, `mist`, `berry`, `plum`, `ink-2`, `ink-3`, or `slate-*`.
- Don't restyle a one-off button or input when a variant exists.
- Don't put `ok` / `warn` / `sky` on small text and call it accessible.
- Don't remove focus outlines without a visible replacement.

## UI change checklist

1. Screenshot the screen before and after. Include the `md` layout and one width below 768px if the shell, toolbar, dialog, or table changed. Screenshots only.
2. Check states: default, hover, focus-visible, disabled, loading, empty, error.
3. Check a long name, an empty list, and a large list. Confirm truncation, wrap, and horizontal scroll inside the table frame.
4. Check a mobile width: drawer opens and closes (overlay, Escape), primary button is full width, no control sits under the safe-area inset.
