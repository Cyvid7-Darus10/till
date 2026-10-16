# Till

A finance agent that lives in Slack. Mention `@Till` in a channel and ask about balances or unpaid
invoices; ask it for an invoice and a finance admin approves it with one click. Till reads and writes
through the Airwallex MCP server, and every
login, to Slack and to Airwallex, is held by [Vercel Connect](https://vercel.com/docs/connect). The
project has no API keys or tokens of its own.

![Till in Slack: a question answered with the team login, an invoice request handed to an admin, approved, created, and visible in Airwallex](docs/demo.gif)

```
#finance
  Sam   @Till which invoices are overdue?
  Till  • Northwind Trading Ltd., EUR 6,200.00, due 2026-10-15, 1 day overdue
        Airwallex: team login

  Sam   @Till invoice Parkside Dental 3,950 USD for the website redesign, net 30
  Till  I can't create invoices with the team login. That needs a finance admin to sign in. I've asked @Alex.

  Alex  @Till go ahead
  Till  [Invoice Parkside Dental]  Website redesign · USD 3,950.00 · Net 30
        Requested by Sam. This will be created with Alex's Airwallex login.
        (Approve) (Cancel)          <- only Alex sees these buttons
  Till  Created invoice INV-0042 for Parkside Dental. Open invoice
```

## How it decides what it may do

| Who asks | Airwallex login used | What Till can do |
| --- | --- | --- |
| Anyone in the channel | One shared **team login**, view only | Answer questions from read-only tools |
| A finance admin | **Their own** login, connected the first time they ask | Create one invoice, after they press Approve |

- **Scopes, not prompts, set the limits.** The team login is granted only `*_view` scopes, so
  Airwallex itself refuses writes. Admin logins add the billing `*_edit` scopes and nothing else.
- **Tools are narrowed again in code** (`lib/tool-policy.ts`). The team login sees only tools that
  Airwallex marks read-only. When creating, the model sees a fixed allow-list of invoicing tools, and
  anything that moves money (transfers, payouts, conversions, simulations) is blocked for every login.
- **Only the named admin can approve.** The card's buttons are visible to that admin only, and the
  server checks the clicker and the thread again before acting.
- **The result is checked.** After the model creates the invoice, Till reads it back from Airwallex
  and compares client, currency, amount and status with what was approved. A mismatch is voided.
- **One card, one invoice.** The Airwallex `request_id` is derived from the approval card, so a
  retried click cannot create a second invoice.
- **Login links can't be forged.** The link that brings an admin back from the Airwallex sign-in is a
  short-lived JWT signed by [Vercel KMS](https://vercel.com/docs/kms). The key never leaves Vercel.
- **Channels can be limited** with `TILL_ALLOWED_CHANNEL_IDS`. Without it, anyone in any channel
  Till is invited to (guests included) can read finance data through the team login.
- **Admins are a list in config** (`TILL_FINANCE_ADMIN_SLACK_IDS`). Removing someone there, or
  revoking their grant in Vercel Connect, takes their access away.

## Code tour

```
app/api/webhooks/slack/route.ts    Slack events and button clicks (verified by Vercel Connect)
app/api/airwallex/connected/       Where the Airwallex sign-in sends people back
lib/bot.ts                         The conversation: answer, hand off, approve, create
lib/agent.ts                       The two model jobs: answer a thread, create one invoice
lib/airwallex.ts                   Whose Airwallex login each job uses
lib/tool-policy.ts                 Scopes and the tools the model may see
lib/invoice-check.ts               Reads the invoice back and voids a mismatch
lib/login-link.ts                  KMS-signed links for the sign-in round trip
lib/invoice-request.ts             The invoice request schema, validated wherever it re-enters
lib/config.ts                      Every setting, validated at startup
lib/copy.ts                        Every sentence Till says
lib/instructions.ts                The model's instructions
```

Till keeps no database. A pending invoice travels inside the Slack buttons and the signed login link,
and is re-validated each time it comes back.

## Set it up

You need a Vercel team with Vercel Connect and KMS available, a Slack workspace you can install apps
in, and an Airwallex sandbox account.

1. **Deploy** this repository to Vercel as a new project (Node 22 or later).
2. **Slack.** In the project, open Connect and add a Slack connector named `slack/till`. Install it
   to your workspace and invite `@Till` to a channel.
3. **Airwallex.** Add an MCP connector for `https://mcp.sandbox.airwallex.com/developer` named
   `airwallex/till-sandbox`.
4. **Signing key.** In Team Settings > Key Management, create an issuer (ES256) and add a grant for
   this project. Copy its issuer id.
5. **Settings.** Add the two required environment variables from `.env.example`:
   `TILL_KMS_ISSUER_ID` and `TILL_FINANCE_ADMIN_SLACK_IDS`. Redeploy.
6. **Try it.** Mention `@Till` in the channel. The first time, an admin gets a private button to
   connect the shared team login.

Optional: `npm run seed` fills an empty sandbox with three example clients and unpaid invoices.

### Settings

All settings live in `lib/config.ts`, are validated when the server starts, and can be changed with
environment variables. None are secrets. See `.env.example` for the full list and defaults.

## Develop

```bash
npm install
vercel link && vercel env pull .env.local   # OIDC token for Vercel Connect, plus your settings
npm run dev

npm run check          # typecheck, lint, tests with coverage
npm run check-logins   # which Airwallex logins are connected (never prints tokens)
```

Logins are saved per Vercel environment, so `check-logins` reports on the environment your
`.env.local` was pulled from (`vercel env pull --environment production` to check production).

## Limits

- Built for an Airwallex **sandbox**. Review the scopes and the tool allow-list before pointing it at
  a live account.
- No persistent state: if Slack retries an event, the duplicate is dropped by message type rather
  than by a stored id. Add a state adapter such as Redis before running many instances.
- The created invoice is checked for client, currency, amount and status, but not line items or due
  date, and the client name match allows a longer legal name ("Parkside Dental" matches "Parkside
  Dental Group"). The model only ever has invoicing tools, under the approving admin's login.
- Answers come from a model and can be wrong. Amounts on approval cards come from the thread, and
  the created invoice is checked against them, but read the card before pressing Approve.

## License

MIT
