# RDV Garage (code)

Implementation of the spec in https://github.com/Ahkh3e/rdvgarage-spec. Specs, decisions, and issues live there; read `docs/architecture.md` and `docs/releases/0.0.1.md` first.

## Rules

- Modules (`packages/*`) never import each other. They share only `@rdv/core` contracts. Register in `apps/mobile/src/modules.ts`.
- Location is shared only within crews, enforced by Postgres access policies, not app code. Change policies in a migration and cover them in `tests/privacy.test.ts`.
- No speed limits or safety rules in the product; safety is disclaimers (`packages/core/src/legal.ts`). Never broadcast speed live.
- Pure logic stays free of React Native imports so it can be unit tested (engine, hub, receiver, week, links).
- Never put the service role key in the app, CI, or git.
- No timelines or dates in docs.

## Commands

```
pnpm typecheck          pnpm test          pnpm test:integration   (needs supabase start and Docker)
supabase db reset       supabase start     supabase stop
```
