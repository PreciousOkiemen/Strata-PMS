# Strata Performance Management System

Web app for quarterly performance reviews. Everyone signs in over the internet and sees the view for their role.

**Stack:** static front end (`public/index.html`) on Vercel, Express API (`server.js`, served by `api/index.js` as a Vercel function), PostgreSQL on Supabase.

## Roles and flow
Employee submits a scorecard, then the **line manager** scores it, the **overall manager** approves, the **calibration committee** approves, the **Chief of Staff** approves, and the **CEO** gives final approval. Any approver can return it one step back with a reason. Every action is recorded in the audit trail.

| Role | Sees | Can do |
|---|---|---|
| Employee | own scorecard | edit and submit own KPIs and self scores |
| Line manager | own + direct reports | score reports, set team goals |
| Overall manager | own + their people | approve, set practice goals |
| Calibration committee | all submitted | approve at calibration |
| Chief of Staff | all submitted | approve, set practice goals |
| CEO | all submitted | final approval, set company goals |

Score maths: category score = sum(KPI weight x score) / 100; total = sum(category weight x category score) / 100. Ratings: 4.50+ Outstanding, 3.50+ Exceeds Expectation, 2.50+ Meets Expectation, below that Below Expectation. **Confirm these bands with HR**; change them with the `RATING_BANDS` env var.

## Deploy (about 30 minutes)
1. **Supabase:** create a project. Open Project Settings > Database > Connection string > *Transaction pooler* (port 6543) and copy it as `DATABASE_URL`.
2. **Run locally once to prepare the database:**
   ```
   npm install
   cp .env.example .env     # fill DATABASE_URL, JWT_SECRET, EXTERNAL_API_KEYS
   export $(grep -v '^#' .env | xargs)
   npm run db:schema        # creates the tables
   npm run db:seed          # creates the starter roster, writes seed-credentials.txt
   ```
   `seed-credentials.txt` holds one temporary password per person. Share each one privately, then delete the file. Everyone must set a new password at first sign-in.
3. **Real roster:** edit `PEOPLE` in `db/seed.js` before step 2, or push your HRIS roster to `POST /api/v3/external/roster/sync` afterwards.
4. **Vercel:** push this folder to a GitHub repo, import it in Vercel, and add the three env vars (`DATABASE_URL`, `JWT_SECRET`, `EXTERNAL_API_KEYS`). Deploy. Add your company domain under Settings > Domains if wanted.
5. Open the Vercel URL and sign in.

`JWT_SECRET`: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.
Forgotten password: `npm run set-password -- someone@strata.ng` prints a new temporary one.

## Integrations (`/api/v3/external`, header `x-api-key`)
- `POST /roster/sync` HRIS roster (people, roles, line and overall manager emails)
- `POST /evidence` Notion / LMS proof of work for a person and quarter
- `GET /scores?fy=&quarter=` CEO-approved scores for PowerBI / ERP
- `GET /pending-actions` who needs to act now, for Slack reminders (the app does not send Slack messages itself)

## Tests
`npm test` runs an end-to-end API test on a throwaway Postgres (needs a non-root user on Linux).

## Known gaps
- No email or Slack sending, no self-service password reset (admin command above).
- Calibration committee approves or returns; it cannot edit scores.
- Session token is kept in the browser's local storage (12 hours) with a strict content security policy; move to cookies if your security team requires it.
