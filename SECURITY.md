# Security

## Reporting a problem

Report security problems privately through GitHub: open the repository's Security tab and choose
"Report a vulnerability". Please don't open a public issue for them.

Include what you found, how to reproduce it, and what an attacker could do with it.

## What Till is designed to prevent

- Anyone who is not a listed finance admin creating anything in Airwallex.
- An admin's approval being used by someone else, or in another thread.
- The model calling tools that move money, whatever a message or an Airwallex record says.
- An invoice going out for a different client or amount than the one approved.
- Forged links that post approval cards into Slack.
- Names or model output that ping a channel or disguise a link in Slack.

## What it does not prevent

Everyone in a channel Till answers in can read the finance data the shared team login can see. The
README section "Before you invite Till to a channel" explains how to limit that.
