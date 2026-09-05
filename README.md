# Berrify

Starter web application workspace. Bootstrapped with **Vite + React + TypeScript**
so the development environment is runnable from day one. Replace the starter UI as
the real product stack and app code land.

## Prerequisites

- Node.js 20+ (developed against Node 22)
- npm 10+

## Local setup

```bash
git clone https://github.com/ggomez-cmd/Berrify.git
cd Berrify
npm install
npm run dev
```

The dev server runs at http://localhost:5173.

## Scripts

| Command             | Description                                  |
| ------------------- | -------------------------------------------- |
| `npm run dev`       | Start the Vite dev server (HMR).             |
| `npm run build`     | Type-check and build for production.         |
| `npm run preview`   | Preview the production build locally.        |
| `npm run lint`      | Run ESLint.                                  |
| `npm run typecheck` | Type-check without emitting output.          |

## Cursor Cloud Agent environment

`.cursor/environment.json` configures the Cloud Agent environment: it installs
dependencies with `npm ci` and runs `npm run dev` in a persistent terminal,
exposing port `5173`.

## License

MIT
