# Airport Dashboard final acceptance

## Automatic data operations

- Sales, inventory, flights, and schedules are monitored through **Data Connections**.
- Routine manager workflows do not require uploads. Recover failed reports from Data Connections, then review the destination workspace.
- Sales reports are paginated server-side; late/missing reports are labelled instead of represented as zero revenue.
- AeroDataBox supplies ANU departures automatically; legacy flight PDFs remain source evidence. Capacity emails populate actual passenger counts when matched.

## AeroDataBox deployment

Follow [Render departure setup](./render-deployment.md) before accepting the Flights and Schedules workflows.

## Local preview

1. Start with `npm run dev`.
2. Set `AUTH_USERNAME`, `AUTH_PASSWORD`, and a 32+ character `AUTH_SECRET` in `.env.local`.
3. Sign in at `/login`.

## Acceptance gates

- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `npm run test:e2e`
