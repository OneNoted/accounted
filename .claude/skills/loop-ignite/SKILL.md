---
name: loop-ignite
description: Verify the agentic loops are actually running and ignite any that are not. Use at the start of any session, or whenever the user manually asks to "check the pr comments" / check logs / triage issues, which signals a loop is not firing. The loops exist (dev_docs/loops.md); the historical failure mode is that nobody initiates them.
---

# loop-ignite

**Goal:** the user never has to type "check the pr comments" again. That prompt was typed 323 times
between 2026-04 and 2026-07; the loops that replace it were built 2026-07-01 and never initiated.
This skill closes that gap.

## When invoked

1. **Audit what is live.**
   - Cloud routines: list scheduled triggers (`/schedule` or the list-triggers MCP tool). Expected per
     `dev_docs/loops.md`: PR+CI triage `0 7,11,15 * * *` UTC, Vercel errors `0 6 * * *` UTC,
     issue triage `0 7,15 * * *` UTC.
   - Local fallback: `CronList` for local scheduled jobs.
   - Evidence of firing: recent `loop/*` branches, PR comments by the loop, `loop:needs-human` labels
     (`gh pr list`, `gh issue list --label loop:needs-human`).
2. **Report a one-screen status table**: loop, expected cadence, last observed run, verdict (LIVE / DEAD / NEVER RAN).
3. **Ignite what is dead.** For each non-live loop, in order of preference:
   - Re-create/enable its cloud routine trigger.
   - If cloud is unavailable, schedule a local fallback (`CronCreate` invoking the matching
     `/loop-*` skill) and say clearly that it only runs while this machine is awake.
   - If neither is possible, run the loop skill once now AND file the blocker as a GitHub issue so
     the gap is visible instead of silent.
4. **Switch-on check (mandatory):** after igniting, verify the trigger exists by listing it again.
   End with either "ALL LOOPS LIVE" or "NOT SWITCHED ON YET: <loop> - <what remains, who flips it>".

## If the user manually types a loop-shaped request

("check the pr comments", "check the vercel/supabase logs for errors", "triage the issues")
Do the requested work, then ALSO run the audit above and tell the user which loop should have made
the request unnecessary, and whether it is now live.
