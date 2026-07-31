# AeroDataBox Departure Sync Design

**Date:** 2026-07-31  
**Status:** Approved direction; pending written-spec review  
**Owner:** Airport Dashboard

## Objective

Automatically populate the Flights workspace and staffing-demand inputs with V.C. Bird International Airport (ANU) departures from AeroDataBox. Use RapidAPI's ongoing free tier, keep the API credential server-side, and remain within the free monthly quota.

## Scope

The integration imports departures only. It covers today's operational board and the upcoming 14-day planning window. It does not import arrivals, aircraft positions, private flights, cargo flights, or passenger manifests.

Existing PDF and passenger-summary imports remain supported. AeroDataBox supplies schedule and live-status fields; it must not erase estimated or actual passenger values from existing records.

## Source and Credentials

Use the AeroDataBox API through RapidAPI:

- Base URL: `https://aerodatabox.p.rapidapi.com`
- Airport: `ANU`
- Direction: `Departure`
- Airport-flight endpoint: `/flights/airports/{codeType}/{code}/{fromLocal}/{toLocal}`
- Maximum interval per request: 12 hours in airport-local time
- Render-only secret: `AERODATABOX_RAPIDAPI_KEY`
- Fixed server-side host header: `aerodatabox.p.rapidapi.com`

The key must never appear in client bundles, API responses, logs, Git history, or browser storage.

## Quota Strategy

The airport-flight endpoint is Tier 2. The synchronizer will use two refresh modes:

1. **Live refresh:** one relative 12-hour departure request when live data is older than six hours.
2. **Planning refresh:** twenty-eight 12-hour requests covering the upcoming 14 days when planning data is older than seven days.

Refreshes are demand-triggered by authenticated flight and schedule workflows rather than relying on a paid background service. A database-backed freshness check prevents repeated requests across Render instances and restarts. This budget leaves headroom within the free allowance for retries and manual recovery.

## Architecture

### AeroDataBox client

A focused server-only client will:

- Build ANU departure requests.
- Apply request timeouts.
- Convert non-success responses into typed errors without exposing response secrets.
- Parse only fields used by the dashboard.
- Accept an injected `fetch` implementation for deterministic tests.

### Normalization

Each AeroDataBox departure becomes the existing `flight_data` shape:

- `flight_date`: local ANU departure date
- `flight_num`: operating carrier flight number
- `airline`: airline name
- `destination`: destination airport name or code
- `scheduled_time`: scheduled local departure represented consistently for storage
- `flight_type`: `departure`
- `status`: normalized scheduled, active, landed/departed, delayed, or cancelled state
- `aircraft_type`: supplied aircraft model/code when available
- `estimated_passengers`: derived only when no existing estimate is present
- `schedule_week_start` and `schedule_month`: derived from `flight_date`

Codeshares will be collapsed to the operating flight where AeroDataBox identifies one. The database uniqueness contract remains `(flight_num, flight_date, flight_type)`.

### Persistence

The synchronizer will read existing matching rows before upsert so that these locally enriched fields survive provider refreshes:

- `estimated_passengers`
- `actual_passengers`
- manually corrected aircraft/capacity data when the provider omits it

Rows outside the fetched range are untouched. An empty or failed provider response never deletes valid existing data.

### Freshness and concurrency

Import state will be recorded through the existing normalized import log using source `flight_schedule`. A refresh checks the most recent successful AeroDataBox attempt before calling the provider. Concurrent refresh attempts use a short-lived database lock or equivalent atomic claim so only one request sequence consumes quota.

## Application Flow

1. An authenticated user opens Flights, loads a flight API, or generates a staffing plan.
2. The server checks live and planning freshness.
3. If data is fresh, the existing database read proceeds immediately.
4. If stale, the server claims the sync, fetches the required AeroDataBox windows, normalizes and upserts departures, then records the result.
5. The requested flight or schedule workflow reads the refreshed database state.

The Flights workspace displays AeroDataBox as the source with the last successful refresh time. Data Connections reports imported record counts and any recoverable failure.

## Error Handling

- Missing API key: skip provider calls, keep existing data, and report configuration required.
- Quota or rate-limit response: retain existing data and expose a non-secret recovery message.
- Timeout or provider outage: retain existing data and record the failed attempt.
- Partial planning failure: do not delete prior rows; upsert successful windows and mark the import incomplete.
- Malformed record: skip that record, count it, and continue processing valid records.
- No departures in a valid response: treat the window as successful without deleting unrelated records.

## Security

- Provider calls run only on the server.
- The RapidAPI key is read from Render environment variables.
- Application authentication remains required for manual synchronization and dashboard APIs.
- Error messages sent to clients exclude upstream headers, full response bodies, and credentials.
- Logs include source, time range, status, counts, and safe error categories only.

## Testing

Implementation follows test-driven development:

- Client request construction for ANU departures and 12-hour limits.
- Response normalization, status mapping, and codeshare deduplication.
- Preservation of local passenger values during upsert.
- Freshness and quota-budget behavior.
- Empty, malformed, rate-limited, and partially failed responses.
- Flight API and schedule-generation integration.
- Browser verification that Flights shows imported departures and Schedules consumes them.

## Deployment and Acceptance

The user completes RapidAPI signup, subscribes to AeroDataBox's free plan, and obtains the API key. Codex adds the key to Render as `AERODATABOX_RAPIDAPI_KEY`, deploys the committed implementation, triggers the first sync, and verifies:

1. Only ANU departures are stored.
2. Today's board displays real provider records and source freshness.
3. The upcoming planning window is populated when the free plan exposes those schedules.
4. Generating a schedule consumes the imported departure demand.
5. Data Connections records a successful AeroDataBox import.
6. No credential appears in source, logs, or client responses.

## Known Limitations

AeroDataBox coverage depends on its upstream sources and cannot guarantee exact real-time status for every ANU flight. Free-tier quotas may change. AeroDataBox does not provide exact passenger loads, so staffing demand continues to use aircraft capacity estimates until airport or airline passenger data is available.
