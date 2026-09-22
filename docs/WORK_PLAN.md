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

**2026-09-22 (later same day) — Base44 CLI auth finally succeeded** (root
cause of every prior failure: the CLI was being killed by a short shell
`timeout` before it could detect confirmation — not an actual auth
problem; fixed by running `base44 login`/`whoami` detached via `nohup ...
&`). Both previously-blocked capabilities now work with `--app-id
69edc5de1c84c71c086635e0` passed explicitly.

**Schedule list obtained** (`base44 workflows list`): 7 automations.
`applyLearning` ("Weekly Agent Prompt Update") and `analyzeAndLearn`
("Weekly Conversation Analysis") both run **weekly on Mondays, ~04:00–
05:30 UTC** — real, confirmed extra load specifically on Monday mornings.
Being weekly (not daily), this alone can't explain a Thu/Fri-specific
pattern.

**Prod log retention is same-day only — confirmed by direct test.**
Queried `base44 logs --env prod` for Sep 18 through Sep 21 explicitly:
all four returned "No production logs found"; only Sep 22 (today)
returned data. **Historical logs for the actual worst/best days (Sep 18,
21 vs Sep 19, 20) are not retrievable — this avenue is closed for
retroactive analysis**, not blocked by auth anymore. Only real-time
monitoring going forward would work via this path.

**New corroborating evidence from today's live logs:** 59 of 77
`reflectizAgent` log lines in a 30-minute window (77%) show a Gemini/
Vertex-AI call (`us-central1-aiplatform.googleapis.com`) still in-flight
*after* the response was already sent to the visitor
(`b44_telemetry:post_response_work`, `non_ok_pre_response:true`). This
directly corroborates a gap identified during the original Sep 10 fix
investigation and never addressed: the `Promise.race`-based timeouts
around the security-guard/opener Gemini calls stop *waiting* on Gemini
but never cancel the underlying call, so it keeps running regardless.
Seen on ~3 in 4 requests even on a moderate day (Tuesday) — a routine,
ongoing condition, not a rare edge case. Not proven to be specifically
worse on Thu/Fri (no historical comparison possible, see above), but a
real, current, unaddressed contributor to unpredictable contention under
bursty load.

**Still not confirmed, still no fix proposed — deliberately.** Two real
leads now exist (Monday weekly-job load; routine orphaned Gemini calls
from uncancelled `Promise.race` timeouts) but neither is confirmed as
*the* cause of the Thu/Fri-specific pattern, and retroactive log
verification is no longer possible. Sep 11 (28.9%, the single worst day
of the whole window) still has no specific explanation.

**Next step:** the `Promise.race`-doesn't-cancel gap is real, current,
and independently worth fixing (via `AbortController`) regardless of
whether it's the full explanation for the weekday pattern — this was
already flagged as deferred, deliberate scope in the original Sep 10 fix
session. Given retroactive logs are gone, the only way to test the Thu/
Fri hypothesis further now is prospective: watch this same live-logs
metric (in-flight-at-response rate) across the next Thu/Fri vs a
weekend, in real time, before drawing a final conclusion.

### 3a. Orphaned Gemini calls from uncancelled `Promise.race` timeouts
**Status: ✅ Done — verified live, 2026-09-22.** (Sub-item of #3 — this
does NOT close #3 itself; the weekday/weekend mechanism is still not
fully confirmed, see above.)

Fixed all 6 `Promise.race`-wrapped Gemini calls in `reflectizAgent/entry.ts`
(`securityGuard`, `outputGuard`, the journey/form-lingering nudge, the
hub-companion nudge, and the main opener generation): each now creates an
`AbortController`, calls `.abort()` at the exact moment its timeout fires
(2000ms for the two guards, 5000ms for the four content-generation calls)
instead of just giving up waiting, and passes the signal into `callGemini()`
(which now accepts an optional `signal` and forwards it to its underlying
`fetch()`). A no-op `.catch(() => {})` on each call prevents the eventual
`AbortError` from surfacing as an unhandled rejection. Timeout durations,
fallback behavior, and the visitor-facing response are all unchanged —
scoped purely to what happens to the abandoned request afterward.

**Live-verified with real before/after log evidence, not just code
review.** Published 2026-09-22 13:09 UTC. Pulled prod logs before and
after via `base44 logs --env prod --function reflectizAgent` (the
`post_response_work` / `inflight_at_response` telemetry, filtered for
calls to `us-central1-aiplatform.googleapis.com`):

| | Pre-fix (same day, before 13:09 UTC) | Post-fix (13:09–13:27 UTC, 5 live test requests + organic traffic) |
|---|---|---|
| Gemini call in-flight after response | 59 of 77 log lines (77%) | 0 of 34 log lines (0%) |

The only `post_response_work` entries remaining post-fix are for the
separate, intentionally fire-and-forget Slack-alert call
(`api.base44.app`, `non_ok_pre_response:false`) — never part of this bug,
correctly still async-by-design. The specific Gemini-abandonment signal
dropped to zero.

Note: prod log retention is same-day only (see above), so this before/
after comparison was only possible because both windows fell on
2026-09-22 — a day earlier and the pre-fix baseline would already have
aged out.

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
**Status: ✅ Mitigated — via Swan, not a native connector**

No GA4 connector exists on this Base44 app directly, and that's not being
pursued. Instead, Swan (a separate connected agent) has live GA4 access and
has been used successfully multiple times this month for real traffic-source
and session-level validation (e.g. cross-checking referral sources against
real GA4 sessions, confirming/debunking suspicious `?ref=` tags). This is an
on-demand, ask-when-needed check rather than always-on reporting data inside
Base44 itself — good enough for verification, not a substitute for wiring
GA4 numbers directly into automated reports if that's ever wanted later.

## 15. No CRM (HubSpot) connector attached
**Status: ✅ Mitigated — via Swan, not a native connector**

Same resolution as #14: Swan has live HubSpot access and has been used
successfully to verify real contacts/deals this month (ThaleLabs/Unni,
Logan Darby) — confirming or debunking self-labeled "Converted" sessions on
request. This remains a manual, ask-Swan-when-needed step, not an automated
cross-check baked into reporting — worth keeping in mind if conversion
numbers ever need to be verified at scale rather than one at a time.

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

