# Athena Work Plan

Tracked, in-repo record of open and closed work on Athena (Reflectiz's AI chat
widget) and its supporting Base44 functions. Read this file first at the start
of any session touching an item below. Update status as you go — mark an item
**Done** only once it's been verified *live* (not just implemented and
syntax-checked), and add new findings as new tracked items here rather than
leaving them only in a session's final chat report.

**Note on provenance:** this file was created 2026-09-22 to replace a work
plan that had only ever existed as a file in a separate chat session with no
repo access — meaning no Claude Code session could read or update it. Its
initial content here was reconstructed from the full history of Base44 MCP
investigation/fix sessions on this app (app ID `69edc5de1c84c71c086635e0`),
not copied from that prior file, which was not accessible. If anything below
doesn't match what you remember from that original plan, flag it — this is a
best-effort reconstruction, not a guaranteed match.

Status legend: ✅ Done (live-verified) · 🟡 In progress · 🔴 Open · ⏸️ Deferred (deliberate scope decision)

---

## 1. Structural crawl-coverage gap
**Status: ✅ Done — verified live**

~24.6% of pages with real traffic (114 of 464) had zero `WebsiteContent`
entry, root-caused to two unconditional mechanisms in `scheduledCrawl`: (a)
`/lp/*` pages permanently excluded from sitemap-based discovery, (b) a
rolling 2-day recency window with no backlog/catch-up. Fixed by making "a
real visitor loaded this page" itself the trigger for a one-time content
fetch, independent of sitemap status or recency: `triggerContentFetchIfMissing`
/ `fireScheduledCrawlSingleUrl` in `reflectizAgent/entry.ts` call a new
`singleUrl` mode in `scheduledCrawl/entry.ts` that reuses the existing
`crawlPage()` logic unchanged. Confirmed still firing from real traffic as
of 2026-09-17 (new `WebsiteContent` rows appearing at non-cron hours).

## 2. Hardcoded Base44 API key
**Status: 🔴 Open**

The internal app-key used for cross-function calls (`app-key-AQMEVGjibXJE...`)
is a literal string hardcoded directly in source — currently 7+ occurrences
across `reflectizAgent/entry.ts` and `scheduledCrawl/entry.ts`, including the
one added for item #1 above. No env var currently exists for it (unlike
`SLACK_WEBHOOK_URL` / `GOOGLE_SERVICE_ACCOUNT_JSON`, which are read via
`Deno.env.get`). Raised repeatedly, never fixed. Real fix requires creating a
Base44 environment variable/secret (a dashboard action, not something
available via the MCP tools used in these sessions) and then updating every
occurrence for consistency — fixing only new occurrences while leaving
existing ones hardcoded doesn't actually reduce exposure.

## 3. Fallback rate — spike fixed, instability unresolved
**Status: 🟡 In progress**

Root-caused to an uncapped `WebsiteContent.list(-lastScanned, 1000)` full-text
scan in `getCandidatesForCategory()` (called on nearly every INIT request,
sometimes twice) plus no OAuth token caching in `reflectizAgent` (a fresh
Google token minted on every single Gemini call). Fixed 2026-09-10: added
`_geminiToken`/`_geminiTokenExpiry` module-scope caching (matching the
pattern already used in `scheduledCrawl`) and wrapped the DB scan in a
4000ms timeout race. This stopped the original crisis level (24–29%,
Sep 8–11) from recurring, but the rate has not settled at a stable floor —
see session notes below for the latest data and open questions.

**Latest data point (as of the 2026-09-22 investigation):** swinging
4%–20% since the fix, hit a new peak (19.7%, Sep 18) exceeding the original
crisis average. A weekday/weekend correlation was hypothesized from one
week of data but not yet confirmed against the full post-fix window. Sep 11
specifically (28.9%, the worst day of the whole spike) remains unexplained.

**2026-09-22 investigation findings:** pulled the full Sep 10–22 window
(13 days). The weekday/weekend pattern is real, not one week's coincidence
— two independent Saturdays (5.8%, 5.6%) and two independent Sundays (3.2%,
4.9%) both land in a tight low band; two independent Thu/Fri pairs (24.0%/
28.9% and 17.3%/19.7%) both land in a consistently high band. But it does
**not** track this app's own traffic volume: Sep 14 (Monday) had 1,806
impressions — the single highest-volume day in the whole window — yet only
11.8% fallback, better than either Thursday, both of which had *less*
traffic. Simple "more visitors = more fallback" does not explain this.

Most coherent explanation given the evidence: contention on a **shared,
fixed-capacity resource that something other than Athena's own visitor
traffic drives** — most plausibly the Gemini/OAuth quota shared across
*every* function in this codebase that calls Gemini (`scheduledCrawl`,
`analyzeAndLearn`, `dailyReport`, `applyLearning`, `backfillCategories`,
`resetCategories`, `trainingAgent`, `slackBot`, not just `reflectizAgent`),
or Base44's own platform-level infrastructure shared across tenants —
either of which could plausibly follow a general weekday-business-hours
pattern unrelated to Reflectiz's own traffic specifically.

**Not confirmed, and no fix proposed — deliberately.** No cron/schedule
config is visible in this repo (Base44 schedules are set via the platform
dashboard, not source-controlled), and Base44 server-side logs remain
inaccessible from this sandbox (the `base44 logs` device-code auth has
blocked every attempt across multiple sessions, including 2026-09-22).
Without confirming the actual mechanism, forcing a code fix here would be
a guess, not a fix. Sep 11 (28.9%, the single worst day of the whole
window) still has no more specific explanation than "this pattern."

**Next step:** get working Base44 log access (needs a human to complete
the device-code browser confirmation outside this sandbox), or check the
Base44 dashboard directly for which functions in this app are scheduled
on which days, to see if anything clusters on Thu/Fri.

## 4. Conversion-tagging: zero-message sessions tagged "Converted"
**Status: ✅ Done — verified live**

`ctaReached` was computed purely from a keyword match against Athena's own
reply text, with no check that the visitor had sent a real message —
allowing a session with zero visitor messages to be tagged `CONVERTED` if
Athena's own opening/nudge reply happened to contain a CTA-shaped word (e.g.
"registration"). Fixed by gating `ctaReached` on `userMessageCount >= 1`.
Root cause of the one historical case forensically traced: a synthetic
"lingering on form" trigger message fell through to the main chat handler
3h24m *before* the `FORM_NUDGE_TRIGGER_RE` interception (added the same day,
2026-09-01) existed to catch it — already independently closed by that
unrelated same-day patch, but the stale `CONVERTED` tag was never corrected
on the historical row. Live-verified 2026-09-22: a real single-message
conversion request still correctly tags `CONVERTED`; a fabricated
zero-message path is not reachable through today's code.

## 5. Conversion-tagging: turn-count alone qualifies "Engaged" even on spam
**Status: ⏸️ Deferred (deliberate scope decision, not an oversight)**

`calcOutcome()` still marks any session `ENGAGED` once `userMsgs >= 3`,
regardless of content — confirmed via real cases this month: an SEO/link-
building spam pitch reached "Engaged" purely on turn count despite Athena
correctly refusing it. Explicitly out of scope for the 2026-09-22 fix
session: no safe, low-risk signal was identified to distinguish "3 real
turns" from "3 turns of spam" without risking false negatives on genuine
short conversations. Needs a real design decision before touching it.

## 6. Transcript-display bug: visitor's first message hidden when geo/Hebrew tags present
**Status: ✅ Done — verified live**

`isCleanMessage()` (the filter building `conversationTranscript` for
storage/display) excluded a visitor's entire message from the transcript
whenever an internal context tag (`[Visitor geo: ...]`, `[Visitor
language: ...]` for Hebrew) was bundled into that same combined string —
correctly detecting the tag's presence, but discarding the whole message
instead of just the tag. Confirmed widespread: 4 of 4 sampled real
conversations with `geo` set showed exactly one turn (the first) missing
from the visible transcript despite a correct `conversationTurns` count.
Fixed by carrying the visitor's real, untagged text alongside the
tag-bundled prompt content (`displayContent` field on the pushed message),
used only for the transcript build — what's sent to Gemini is untouched.
Live-verified 2026-09-22 (after confirming a genuine deploy-propagation
delay, not a bug, explained 3 initial failed live tests): a fresh geo-set
test conversation now shows the visitor's real first message cleanly, no
tag leakage, no missing content.

**Historical rows cannot be repaired.** The original untagged message text
was only ever held in server memory for that single request; only the
already-filtered (broken) transcript was ever persisted. Confirmed no
backfill path exists for the known-affected rows (`37dfc470`, `85a34018`,
`b4829b31`, `0b034df3`, and the Sep 1 Offensive Hub / `9607db7e` session).

## 7. PendingConfigChanges — AI system-prompt change proposals
**Status: 🔴 Open (1 of 2 unresolved as of 2026-09-17)**

- Sep 14 proposal: reviewed and **rejected** 2026-09-17. Closed, no action needed.
- Sep 9 proposal: still **pending**, unreviewed for 8+ days as of last check.
  Its own auto-generated `changeSummary` field is truncated/broken and
  doesn't actually describe the change. On inspection of the raw
  `proposedPrompt`/`previousPrompt` diff: approving it as-is would silently
  **delete** three working conversation rules (repeated-off-topic handling,
  the financial-services page recommendation, and the Sucuri/WAF
  competitor-objection script) while adding two reasonable small
  improvements (acknowledging vague Turn-2 replies naturally, handling
  ambiguous inputs). **Recommend it not be approved until rewritten** to
  keep the existing rules intact.

## 8. RAG keyword-search: a third unbounded `WebsiteContent.list(500)` scan
**Status: 🔴 Open — flagged, not fixed**

Found during the fallback-rate investigation: a third instance of the same
unbounded-scan shape (fixed for item #3 above) exists in a RAG-style
keyword-search helper (`reflectizAgent/entry.ts`, ~line 403), used during
actual chat-message handling (not the INIT/opener path item #3 covers).
Same risk under load, explicitly out of scope when found — flagged here so
it isn't lost.

## 9. Slack unfurl-suppression (link preview cards cluttering the channel)
**Status: ✅ Done — code confirmed live**

Every `chat.postMessage`/webhook call posting session activity was
triggering Slack's automatic link-unfurl preview card under every message.
Fixed by adding `unfurl_links: false, unfurl_media: false` to all affected
calls: `slackAlert`, `slackBot` (both `chat.postMessage`-based), plus the
webhook-based `dailyReport`, `widgetUptimeCheck` (2 call sites),
`analyzeAndLearn` (2 call sites), and `applyLearning`. `reflectizAgent`'s own
webhook alert was checked and correctly left untouched — it carries no
links, so it was never affected. Code confirmed live in all 6 files; a live
visual check that the preview card is actually gone in the Slack channel
itself has not been explicitly performed in any session on record — worth a
quick manual glance next time an event fires.

## 10. Slack threading
**Status: ✅ Done — verified live, holding**

Session activity posts as one top-level message per session with
subsequent events threaded as replies (`thread_ts` / `Conversations.
slackMessageTs`), instead of a flood of separate top-level posts per
visitor. Re-confirmed live multiple times through 2026-09-17.

## 11. Registration-page personalization
**Status: ✅ Done — verified live, holding**

The "lingering on the form" nudge (`FORM_NUDGE_TRIGGER_RE` branch) now
references the visitor's actual prior page/journey instead of a generic,
self-introducing message repeated on every visit. Re-confirmed live through
2026-09-17.

## 12. Learning-hub content overhaul
**Status: ✅ Done (core) — 🔴 4 low-traffic pages still open**

Root-caused why gated webinar/report pages were failing at high fallback
rates, fixed categorization, added curated content for the highest-traffic
pages. As of 2026-09-17: 45 active learning-hub pages carry real
categories, several explicitly `lockCategories: true`. Still uncategorized:
`soccer-watch-reflectiz`, `reflectiz-taboola-marketing-security-webinar`,
`webinar-client-side-security-challenges`, `client-side-web-app-security-
buyers-guide` — small, low-traffic tail, not yet curated.

## 13. Bubble-quality guardrail
**Status: ✅ Done — verified live, holding**

The opener-generation prompt explicitly rejects bare category-question
phrasing with no concrete hook (e.g. "TPRM in the AI Era trends?") and
requires a real stat or named entity. Re-confirmed present in the live
prompt through 2026-09-17.

## 14. No analytics (GA4) connector attached
**Status: 🔴 Open — roadmap item**

Traffic-source breakdowns in reporting rely entirely on Athena's own
chat-engagement referral data (a small, possibly biased sample — sessions
that triggered some widget interaction only), not real total site traffic.
Connecting GA4 would replace this proxy with the real picture.

## 15. No CRM (HubSpot) connector attached
**Status: 🔴 Open — roadmap item**

Self-labeled "Converted"/CTA-reached conversations cannot be independently
verified from within Base44 — every self-reported conversion this
engagement has surfaced has needed manual cross-checking against real CRM
records by a human. A connector would remove that manual step.

## 16. Phase 2b — bubble timing/exposure question
**Status: 🔴 Open — long-standing, no new data**

`wasFallback` is a client-side timing flag (set true if the bubble is shown
before the real backend response arrives), not a pure content-quality
signal — meaning some fraction of fallback-flagged impressions may reflect
correct content served just slightly late, not genuinely bad content. Still
pending clean data to separate the two; not touched by any session on
record so far.

## 17. Open rate vs. target
**Status: 🟡 Tracking, behind pace as of last measurement**

Target: 5× August's ~0.2% baseline → ~1.0%. Sep 1–16 impressions-weighted
average: ~0.35%, flat across the window with no upward trend visible. At
that pace the full month would land well under target — this is a KPI to
keep watching each reporting cycle, not a single fix to ship.

