# /legal/ — frozen legal text

This directory is the **only** place legal wording lives. Components render
these markdown files; nothing inlines legal copy. The optimizer, offer engine,
and any automated agent are forbidden from touching this directory.

Files:

| File | Rendered at | Must be accepted at checkout |
| --- | --- | --- |
| `terms-of-service.md` | `/legal/terms` | linked |
| `service-agreement.md` | `/legal/service-agreement` | **checkbox** |
| `refund-policy.md` | `/legal/refunds` | **checkbox** |
| `privacy-policy.md` | `/legal/privacy` | linked |
| `sms-consent.md` | `/legal/sms` | **checkbox** (and for "text me the price sheet") |

`HASHES.lock` holds the SHA-256 of each file. Every order stores the hashes
of the exact versions the customer accepted, plus timestamp and IP.

## How to change legal text (the `LEGAL:` flow)

1. Edit the markdown file(s).
2. Run `npm run legal:hash` to rewrite `legal/HASHES.lock`.
3. Commit the text and the lock **together**, with a commit message that
   starts with `LEGAL:` and a git author email listed in `legal/APPROVERS`.

Anything else fails the pre-commit hook locally and the `legal-guard` job in
CI. See `RUNBOOK.md` for the full procedure.
