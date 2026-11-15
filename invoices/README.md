# MEC Invoices on Vercel

Private finance tool for Mansfield Eyre Consulting. The Clocker remains at the repository root; this independent Next.js project lives in `invoices/`.

## Deployment

- Vercel project: `mec-invoices`, team `mec6`, root directory `invoices`, Node.js 24.
- **Vercel Authentication must protect ALL deployments, including the production domain.** The app relies on this platform access control; do not publish it without protection.
- Private Blob store: `mec-invoice-records`. The connected project receives a server-only storage token. Never expose that token through a `NEXT_PUBLIC_` variable.
- Production records use `finance/records.json`; previews use a separate path. Saves compare both revision and Blob ETag to reject stale updates.
- Initial import is separate from code deployment and requires approval to transfer existing client and financial data. A server-only `MEC_INVOICE_MIGRATION` variable can initialize an absent production record. It never replaces existing records. Remove that variable after a verified import.
- No client records, invoice contents, or bank details belong in Git.

## Development

Run `npm ci`, `npm run dev`, `npm run typecheck`, and `npm run build`. Private storage is required for persistence; configure development credentials locally and keep `.env*` ignored.

Invoice calculations, optional printed discounts, optional due date/vendor number, editable numeric fields, duplication, trash/restore, client selections, and configurable numbering are retained from MEC Invoices.
