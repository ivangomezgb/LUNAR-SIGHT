# Lunar Landing Site Navigator

NASA Space Apps 2026. Read `docs/HANDOFF.md` first: status, how to run, pending work and the 3D / 360° plan.

- `pipeline/` (Python 3.12) computes; `web/` (Vite + React + TS) displays; they share only JSON in `web/public/data/`.
- Contracts: `docs/contracts.md` and `web/src/lib/types.ts`. Assumptions: `docs/assumptions.md`.
- Tests: `python -m pytest pipeline/tests` and `cd web && npx vitest run`; build with `npm run build`.
- UI text in English; never publish synthetic data; mark AI-written commits.
- Windows + OneDrive: see the environment notes in `docs/HANDOFF.md` §4 (Codex stdin, Vite EPERM, tile cache).
