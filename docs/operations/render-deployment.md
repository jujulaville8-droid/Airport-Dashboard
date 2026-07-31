# Render departure setup

The dashboard imports V.C. Bird International Airport (`ANU`) departures from AeroDataBox through RapidAPI. The key is server-only and must never be placed in a `NEXT_PUBLIC_` variable.

## First deployment

1. Apply every SQL file in `supabase/migrations` in numeric order. Migration `006_aerodatabox_sync.sql` creates the synchronization lease table and its service-role-only claim function.
2. In the Render web service, add `AERODATABOX_RAPIDAPI_KEY` as a secret environment variable using the RapidAPI application key.
3. Confirm the existing Supabase and authentication variables from `.env.example` are also present.
4. Deploy the current `main` branch. The standard Render commands are `npm ci && npm run build` and `npm start`.
5. Sign in, open **Flights**, and select today. This triggers the first live refresh.
6. Open **Schedules** and generate a schedule covering the upcoming dates. This triggers the first planning refresh before demand is read.
7. Open **Data Connections**. The flight provider should show **Connected**, and flight schedule import history should show the AeroDataBox result.

## Quota behavior

- Live data is considered fresh for six hours.
- The upcoming 14-day planning window is considered fresh for seven days.
- A 15-minute database lease prevents duplicate requests across concurrent Render instances, including worst-case provider timeouts.
- Failed attempts enter a 15-minute retry cooldown so reloads cannot burn quota during an outage.
- Provider failures retain existing flight rows and do not block schedule generation.

Do not repeatedly clear `external_sync_state`; doing so bypasses the free-tier protections.

## Recovery

If Data Connections reports a flight provider failure:

1. Confirm the RapidAPI subscription is active and the Render secret exists.
2. Review Render logs for `401`, `403`, or `429` responses without copying credential values.
3. Correct the subscription or secret and redeploy.
4. Reopen Flights to retry. Existing stored departures remain available while the provider is unavailable.

Legacy PDF upload remains available in Data Connections for historical recovery.

## Key rotation

Create or select the replacement RapidAPI application key, replace `AERODATABOX_RAPIDAPI_KEY` in Render, and redeploy. Remove or revoke the old key only after the new deployment is live and a Flights refresh succeeds. Never commit either key.
