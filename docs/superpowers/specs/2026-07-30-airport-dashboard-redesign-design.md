# Airport Dashboard Product Redesign

**Date:** 2026-07-30  
**Status:** Approved for implementation planning  
**Product:** The Tailor's Daughter airport retail operations dashboard  
**Location:** V.C. Bird International Airport (ANU), Antigua and Barbuda

## Objective

Rebuild the dashboard's product experience while preserving its trusted domain logic. The result must feel like a current, deliberately designed airport retail operations product and work more reliably than the existing interface.

The redesign is not a styling pass. It covers information architecture, responsive behavior, automatic data ingestion, page workflows, validation, loading and failure states, accessibility, testing, and maintainable component boundaries.

## Approved decisions

- Visual direction: **Terminal Precision**
- Product approach: **rebuild in place**
- Primary user: **one owner/manager**
- Overview priority: **daily action brief**
- Data ingestion: **fully automatic by default**
- Manual upload: **secondary recovery tool in Data Connections**
- Existing stack: retain Next.js 16, React 19, TypeScript, Supabase, Gmail, Anthropic, and Vercel

## Design direction

Terminal Precision is bright, official, and quietly premium. It combines airport wayfinding clarity with enough retail warmth for daily use.

### Color system

- Terminal Navy `#122535`: primary navigation and high-authority surfaces
- Runway Amber `#F4B41F`: active state, focus, priority, and signature accent
- Tower Glass `#F7F9FB`: application background
- Paper White `#FFFFFF`: content surfaces
- Lagoon Teal `#1A817B`: healthy, current, arrival, and positive states
- Alert Clay `#D45835`: urgent and destructive states
- Slate Ink `#142535`: primary text
- Instrument Gray `#61727E`: secondary text
- Structural Line `#D8E1E6`: borders and separators

Semantic tokens must map to these values. Page components must not introduce arbitrary colors.

### Typography

- Display and headings: a modern grotesk with a compact, authoritative silhouette
- Body and controls: a highly legible sans serif
- Data, times, identifiers, and status labels: a tabular monospace

The final font selection must be available through `next/font`, remain legible at operational sizes, and avoid the existing boutique-serif aesthetic.

### Layout signature

The product's signature element is the **traffic window strip**: a horizontal operational band that connects upcoming passenger traffic with staffing and sales opportunity. It appears on the Overview and informs related flight and schedule views.

Use restrained motion only for meaningful state changes, loading transitions, and direct manipulation. Respect `prefers-reduced-motion`.

## Product architecture

The existing application remains a single Next.js App Router product with four conceptual layers:

1. **App shell**
   - Responsive desktop sidebar
   - Mobile bottom navigation
   - Global page header and actions
   - Import health and freshness
   - Notification and account controls

2. **Operational pages**
   - Overview
   - Sales
   - Inventory
   - Flights
   - Schedules
   - Concession
   - Data Connections
   - Login

3. **Shared workflow components**
   - Date and range controls
   - Metrics
   - Charts and tables
   - Filters
   - Status banners
   - Dialogs and drawers
   - Loading skeletons
   - Empty, stale, error, and success states
   - Recovery-upload panels

4. **Domain services**
   - Counterpoint importers
   - Flight PDF and passenger-summary parsers
   - Scheduling algorithm
   - Inventory analytics
   - Concession calculations and export
   - AI analysis
   - Email delivery
   - Supabase access

Domain behavior is preserved unless a failing test, schema mismatch, or validated defect justifies a targeted change.

## Information architecture

### Desktop

The persistent sidebar groups pages by the manager's mental model:

- **Today**
  - Overview
- **Commerce**
  - Sales
  - Inventory
- **Operations**
  - Flights
  - Schedules
- **Finance**
  - Concession

The sidebar footer contains automatic-import health. Selecting it opens Data Connections. The account and sign-out controls remain separate from operational navigation.

### Mobile

The mobile bottom navigation contains five destinations:

- Today
- Sales
- Stock
- Flights
- More

More contains Schedules, Concession, Data Connections, and account actions. Mobile prioritizes immediate actions and concise summaries; it does not compress desktop tables into unreadable layouts.

## Page workflows

### Overview

The Overview is a daily action brief, not a generic collection of cards.

Content order:

1. Date, greeting, freshness, and refresh action
2. Traffic window strip
3. Prioritized action cards:
   - Act now
   - Watch
   - On track
4. Sales pace
5. Upcoming passenger traffic
6. Staffing coverage
7. Inventory actions
8. Automatic-import health

Every action card links directly to the relevant filtered detail view.

### Sales

- Show automatic daily and monthly imports
- Present today, recent trend, uploaded coverage, comparisons, and drill-downs
- Use date/range selection without timezone drift
- Keep AI analysis as an explicit user action
- Move routine upload controls out of the main workflow
- Show data freshness and import source
- Distinguish a real zero-sales day from missing or stale data

### Inventory

- Lead with critical, at-risk, dead-stock, and overstocked actions
- Provide a filterable and sortable SKU table
- Open item details in a focused drawer
- Allow reorder-rule editing with inline validation
- Show sales velocity, days of cover, stock value, and history
- Keep AI recommendations tied to visible inventory evidence
- Use automatic snapshots and item-sales ingestion

### Flights

- Show automatic schedule ingestion and passenger-summary ingestion
- Present a daily board, passenger traffic forecast, and month analytics
- Compare estimated and actual passengers where available
- Surface unmatched passenger-summary records as recoverable import issues
- Preserve access to stored schedule PDFs
- Make date, month, airline, arrival, and departure filtering explicit

### Schedules

- Default to weekly planning
- Display staff constraints clearly
- Generate schedules from current flight demand
- Allow timeline editing by pointer and keyboard
- Save edits immediately with visible success feedback
- Roll back the UI if persistence fails
- Support manual shift add/delete, schedule clear, email notification, and Excel export
- Show coverage gaps as actionable periods tied to flights

### Concession

- Use automatically imported sales totals
- Permit an explicit card/cash split override
- Show MAG, percentage rent, exchange rate, commissions, and payable amount transparently
- Explain whether the month is below or above the threshold
- Produce the airport authority format through the existing export
- Never convert missing data into a valid-looking zero calculation

### Data Connections

This new area owns ingestion and recovery:

- Gmail connection state
- Cron health
- Last successful scan
- Sales, item sales, inventory, flight schedule, and passenger-summary source states
- Import history
- Clear failed-message and parser details
- Retry instructions
- Secondary manual uploads for recovery
- Configuration guidance when environment variables are missing

### Login

- Retain single-manager signed-cookie authentication
- Present a focused sign-in screen
- Provide clear invalid-credential and server-configuration errors
- Preserve the requested destination after login

## Automatic data flow

The normal ingestion flow is:

`Gmail → Vercel Cron → sender/size/type validation → classification → domain parser/importer → Supabase → import log → dashboard freshness`

Requirements:

- Imported and failed Gmail labels preserve idempotency
- Every source exposes last-attempt and last-success timestamps
- Import logs include source, result, record counts, and useful recovery details
- A failed import does not overwrite the last valid dashboard result
- Failed or stale data is visibly marked
- Manual recovery uses the same validation and importers as automatic ingestion
- Cron authentication remains separate from the manager session

## Error and state handling

Every page and workflow must support:

- Loading skeleton
- Guided empty state
- Current data
- Stale data
- Recoverable error
- Blocking configuration error
- Success feedback where the user changes state

Rules:

- Never silently swallow failed requests
- Never interpret a failed query as zero
- Keep the last valid result visible when a refresh fails
- Explain what failed in plain language
- Show the recovery action beside the error
- Validate files before reading them into memory
- Confirm destructive actions
- Roll back optimistic edits when persistence fails
- Return generic public server errors while logging useful server context

## Database readiness

The repository must be able to initialize a fresh Supabase environment. The redesign includes committed migrations for schema currently assumed by the application but absent from the repository, including:

- `staff_members`
- `sales_transactions.upload_type`
- `flight_data.schedule_month`
- A dedicated numeric ticket-count column replacing the `cust_no` workaround

Migrations must preserve existing production data and include any required indexes or compatibility steps.

## Component boundaries

Large page files must be decomposed into domain-focused components. A component should have one clear job and receive typed data through a defined interface.

Expected shared units include:

- `AppShell`
- `DesktopSidebar`
- `MobileNavigation`
- `PageHeader`
- `TrafficWindow`
- `ActionCard`
- `Metric`
- `StatusBadge`
- `FreshnessIndicator`
- `DataTable`
- `FilterBar`
- `EmptyState`
- `ErrorState`
- `LoadingSkeleton`
- `ConfirmDialog`
- `DetailDrawer`
- `ConnectionStatus`
- `RecoveryUpload`

Supabase must use generated database types. API request bodies must use explicit runtime validation.

## Accessibility and responsive behavior

- All functionality must be keyboard accessible
- Focus states must be visibly distinct
- Text and controls must meet WCAG AA contrast
- Touch targets must be at least 44 by 44 CSS pixels
- Icons require accessible names when they have independent meaning
- Color cannot be the only status signal
- Motion must respect reduced-motion preferences
- Tables must switch to suitable cards or controlled horizontal regions on small screens
- Dialogs and drawers must manage focus correctly
- Test phone, tablet, laptop, and wide desktop layouts

## Testing and verification

### Unit tests

- Date and number formatting
- Freshness and source-health derivation
- Action-priority derivation
- Concession calculations
- Inventory-risk calculations
- Scheduling helpers
- Import classification and parser edge cases

### Component tests

- Navigation and active states
- Filters and date controls
- Empty, loading, stale, success, and error states
- Dialogs and drawers
- Rule-editing forms
- Recovery controls
- Responsive navigation

### API tests

- Authentication boundaries
- Body and query validation
- Upload type and size validation
- Database error handling
- Automatic-import authorization
- Failure response shapes

### End-to-end tests

- Sign in and sign out
- Review the daily action brief
- Inspect automatic-import health
- Recover a failed import manually
- Review daily and monthly sales
- Filter and update inventory rules
- Review flights and stored schedule PDF
- Generate, edit, email, and export a schedule
- Review and export concession calculation

### Completion gate

The redesign is complete only when:

- Tests pass
- Lint passes
- Production build passes
- Browser console has no unexpected errors
- Every page works with current, empty, stale, loading, and failure states
- Desktop and mobile critical journeys pass
- Repository status contains only intentional changes

## Parallel implementation boundaries

Parallel agents may work after the implementation plan assigns explicit ownership:

1. Design system and app shell
2. Commerce pages and shared data components
3. Operations and finance pages
4. Automatic ingestion, database readiness, and API reliability
5. Integration, accessibility, and end-to-end verification

Agents must not revert other agents' edits and must coordinate changes to shared files. Central integration review resolves cross-cutting issues.

## Out of scope

- Multi-user authentication
- Role-based permissions
- A replacement database or backend platform
- A native mobile application
- Changes to proven business rules without evidence of a defect
- New third-party data sources beyond the currently supported Gmail workflows
