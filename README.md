# MEC Time Tracker

A time-tracking app for clocking in and out, recording breaks, and logging coaching sessions.

## History and data safety

- Every change is saved to Firebase Realtime Database.
- A recovery copy is also saved in the current browser so a temporary Firebase problem does not erase the visible history.
- The sync badge shows whether an entry is cloud-synced or currently available on this device only.
- Dates use the browser's local calendar date rather than UTC, preventing late-night entries from being filed under the wrong day.
- Missed or incorrect entries can be added or edited with an auditable correction reason.
- The last change on a date can be undone without losing the earlier history.

## Reports

- Review weekly or monthly totals for work, coaching, breaks, and recorded days.
- Export the selected report as CSV.
- Use Print / PDF to create a shareable report from the browser.

The Firebase variables in `.env.example` must be configured in the deployment environment. Firebase Realtime Database rules must permit the app's intended user to read and write the `entries` path. For multi-user use, add Firebase Authentication and user-scoped database rules before storing staff records.

## Development

```bash
npm install
npm run dev
```

Create a production build with `npm run build`.
