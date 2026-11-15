# MEC Workspace on Vercel

The full private MEC workspace: coaching clients and coachees, session records, assignments, reports, catalogue, finance, and assessments. Clocker retains its existing Vercel deployment and Firebase records.

- Vercel project `mec-workspace`, root `workspace`, Node.js 24, Next.js 16.
- Vercel Authentication must protect **all** deployments, including production. Server APIs rely on this owner-private platform boundary.
- The project uses its own **private** Blob store. Workspace, finance and assessment records are stored separately with conditional ETag writes and version checks.
- Finance runs at `/finance` on the same origin, so the embedded view uses the same sign-in cookie. Workspace clients, issuer details, and catalogue are canonical for invoices.
- Assessment UI runs at `/assessments`. The existing Google Sheets ingestion endpoint is retained as a service bridge, so current form submissions continue without changing the script. Transfer and ongoing synchronization require explicit approval and are disabled unless `MEC_ASSESSMENT_SYNC_ENABLED=true`. The original Assessment Hub remains available meanwhile. Once enabled, synchronization preserves coaching annotations.
- `MEC_ASSESSMENT_SOURCE_TOKEN` and `MEC_ASSESSMENT_SOURCE_KEY` are server-only service credentials. Never expose them to browser code or Git. Existing connection-code generation and disconnect operations continue through that scoped service bridge.
- Production data paths are `workspace/records.json`, `finance/records.json`, and `assessments/records.json`. Preview data uses a `preview/` prefix.
- No private records, seed participant files, bank details, or migration payloads belong in this repository.

Run `npm ci`, `npm run typecheck`, and `npm run build`. Local development requires server-only private storage credentials in an ignored `.env.local` file.
