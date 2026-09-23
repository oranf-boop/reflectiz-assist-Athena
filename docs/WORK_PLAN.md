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
**Status: ✅ Done (code + secret) — ⚠️ live behavioral proof not achievable, see below**

The internal app-key used for cross-function calls (`app-key-AQMEVGjibXJE...`)
was a literal string hardcoded in 8 places across `reflectizAgent/entry.ts`
(7) and `scheduledCrawl/entry.ts` (1). Previously flagged as blocked on a
dashboard-only action — **that was re-checked 2026-09-22 and found to no
longer be true** now that CLI auth works (see item #3's auth fix). `base44
secrets set` genuinely exists and works: created `BASE44_INTERNAL_API_KEY`
directly via `base44 --app-id 69edc5de1c84c71c086635e0 secrets set
"BASE44_INTERNAL_API_KEY=..."`, no dashboard step needed, confirmed present
afterward via `secrets list`. All 8 occurrences replaced with
`Deno.env.get("BASE44_INTERNAL_API_KEY")` (module-scope const, same pattern
as `SLACK_WEBHOOK_URL`), 0 literal occurrences remain (grep-confirmed), both
files syntax-check clean. Published 2026-09-22.

**Live verification attempted thoroughly, but hit genuine structural
limits — reporting honestly rather than claiming a clean proof that
doesn't exist.** A live test conversation through the fixed code path
succeeded normally (no crash from the env-var change). But isolating
whether the *specific key value* is being read and used correctly turned
out to be untestable through either consumer of this key, for reasons
pre-existing and unrelated to this fix:
- `scheduledCrawl`'s `singleUrl` endpoint does not enforce the
  Authorization header at all — confirmed by sending it both the correct
  key and a deliberately wrong one; both produced identical responses.
- `reflectizAgent`'s own `x-athena-prewarm` header check (the other
  consumer) is currently unreachable dead code, since `SOFT_LAUNCH_GATE =
  false` makes `gateAllows()` return `true` unconditionally before that
  check is ever reached.
- Neither `scheduledCrawl` nor `slackAlert` (the two functions this key is
  sent to) log anything on their success paths, so prod logs couldn't help
  distinguish "worked" from "silently no-op'd."
- A secondary attempt to confirm via the test conversation's
  `firstMessageAlertSent` field (which the code sets unconditionally on
  conversation creation) found it unexpectedly absent from the stored
  record — flagged as a separate, unconfirmed oddity worth a closer look
  in a future session, not assumed to be caused by this fix.

**Bottom line:** the fix itself — eliminating the hardcoded secret from
source — is complete, deployed, and confirmed via source/syntax
verification. Confirming the *exact value* is correctly consumed live
would require either adding a real auth check to `scheduledCrawl`'s
`singleUrl` endpoint (arguably a good idea on its own merits) or re-enabling
`SOFT_LAUNCH_GATE`, neither of which was done here since both are out of
scope for a credential-hygiene fix.

## 18. Internal endpoints have no auth enforcement
**Status: 🔴 Open — new finding, 2026-09-22**

Discovered while verifying item #2: `scheduledCrawl`'s `singleUrl` mode
(added for item #1's crawl-coverage fix) does not check the Authorization
header at all — a deliberately wrong key produces the identical result to
the correct one. Separately, `reflectizAgent`'s own equality check on this
same key is currently dead code, since `SOFT_LAUNCH_GATE = false` makes
`gateAllows()` return true before that check is ever reached. Net effect:
the internal API key now lives safely out of source control (item #2),
but isn't actually enforced by either receiving function right now — a
real, separate gap, arguably bigger in practice than the hardcoding
itself was. Not fixed — found during a different task, correctly not
fixed opportunistically without being asked first.

**Also flagged, unconfirmed:** a test conversation's `firstMessageAlertSent`
field was unexpectedly absent from the stored record despite the code
setting it unconditionally on conversation creation — noted as a new,
unverified lead from the same investigation, not yet looked into.

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

### 3b. Curated pages serving a stale/fallback `reply` alongside a correct `bubbleText`
**Status: ✅ Done — fixed, published, and live-verified 2026-09-23**

Found while investigating a live report of 3 curated pages (`/offensive-hub/`,
`/blog/elfsight-incident/`, `/blog/data-security-standards/`) showing a correct
curated `bubbleText` alongside a generic fallback `reply`. Confirmed by reading
`reflectizAgent/entry.ts`'s INIT opener path directly:

- `bubbleText` and `reply` (`opener`) are **not generated from the same source**.
  `CURATED_BUBBLES_EN`/`DE`/`FR`/`ES`/`IT` (hardcoded, always current) override
  `bubbleText` only — by explicit design, per the code's own comment: `// Curated
  bubble overrides generated one -- opener stays Gemini-generated`. There is no
  curated-reply equivalent; `opener` always depends on a live Gemini call
  succeeding validation, falling back to one of 7 generic pageType-keyed
  sentences (`FALLBACK_SENTENCES_BY_TYPE`) if Gemini times out, fails JSON
  parsing, or fails post-generation validation (must reference the selected
  asset's URL, ≥4 words of prose, no self-link, no referral-source mention).
  Whichever pair results (real or fallback `opener`, paired with the always-
  correct curated `bubbleText`) gets cached **together** in one `PageOpeners`
  row via `upsertPageOpener`, and every subsequent visit for that page+language
  serves the cached pair verbatim with no re-check of `curatedBubble` and no
  retry of generation.

- **This is not simple pre-fix cache staleness** (the pattern already fixed for
  `ai-retail-webinar`/`supply-chain-anz`/`tprm-ai-gartner-2026`). Directly
  queried `PageOpeners`: the `/blog/data-security-standards/` row was freshly
  regenerated at 2026-09-23 06:28 UTC — hours before this investigation — and
  the fresh regeneration **still** produced a generic fallback `opener`
  recommending an unrelated page. Cache invalidation alone will not durably fix
  this; the underlying Gemini-generation reliability issue would just refill
  the cache with the same fallback on the next request.

- **Scope, sampled across all 76 `CURATED_BUBBLES_EN` URLs** (72 found in
  cache): **11 of 72 (~15%) currently serve a fallback `opener`** paired with a
  correct curated `bubbleText` — not limited to the 3 originally reported.
  Affected: `blog/data-security-standards`, `blog/top-10-agentic-web-app-
  pentesting-tools`, `blog/apache-airflow-security-exposed-instances`,
  `blog/paypal-breach-2026`, `blog/javascript-obfuscation`, `blog/jscrambler-
  npm-package-compromise`, `blog/stripe-skimmer-2026`, `blog/ibm-cost-of-a-
  data-breach-report-2026`, `blog/bank-websites-loan-data-tracking-pixels`,
  `blog/ai-retail-webinar`, `blog/disney-ccpa-fine-biggest-so-far`. (The
  originally-reported `/offensive-hub/` and `/blog/elfsight-incident/` carry
  large backlogs of un-deduplicated historical cache rows rather than one clean
  current row — see next point.)

- **Notable, unconfirmed timing correlation, flagged not claimed:** 8 of the 11
  fallback rows were generated in the ~17 hours *after* today's AbortController
  fix (item #3a, published 2026-09-22 13:09 UTC) — the very code path that
  fix touched includes this same opener-generation Gemini call. Only 3 predate
  it (2 shortly before on the same day, 1 from 2026-08-15). Comparing pages
  touched post-fix (18.4% fallback, n=38) vs. pages not touched since (11.8%,
  n=34) is directionally consistent with a regression but is **not a
  controlled comparison** (different pages, different times) — no mechanism
  connecting the two was confirmed in code, and prod-log confirmation for the
  exact 06:28 UTC failure was not obtained this session (CLI re-auth in the
  fresh sandbox did not complete in time). Left as an open lead, not a
  conclusion.

- **Separately noticed, not chased further:** curated-bubble language coverage
  is thin outside English (`CURATED_BUBBLES_DE/FR/ES/IT` cover ~15-16 of the
  76 URLs each) — a non-English visitor to an uncovered curated page gets an
  **English** `bubbleText` (via the `map[url] || CURATED_BUBBLES_EN[url]`
  fallback in `getCuratedBubble`) paired with a native-language `opener`,
  e.g. a cached `blog/elfsight-incident` row mixing an English curated bubble
  with a French fallback opener. Same root design gap, different symptom.

**Decision made 2026-09-23: pursue option (a).** Implemented, not yet published.

- **Retry policy:** when the page is curated (`curatedBubble` truthy) and the
  first Gemini opener attempt fails validation/timeout/parse, retry **exactly
  once** with a fresh, independent `AbortController` + 5s budget (same as the
  original attempt, so a failed retry aborts its own call cleanly instead of
  becoming a second orphaned background call, per item #3a). Uncurated pages
  are completely unchanged — still one attempt only.
- **If the retry also fails:** the generic fallback sentence is still shown to
  *this* visitor (unchanged visitor-facing behavior on double failure), but
  the result is **not written to the `PageOpeners` cache** (chose option (ii)
  over a short-TTL cache, since a TTL would need new cache-schema/expiry logic
  for a race that a per-request retry cap already bounds, while skipping the
  write is simpler and self-healing: the next visitor gets a fresh attempt,
  and once any visit succeeds it's cached normally and all further visits are
  free cache hits, no more Gemini calls at all).
- **Worst-case cost:** at most 1 extra Gemini call, and only for the ~15% of
  curated pages currently stuck (cache-hit visits and uncurated pages: zero
  extra cost). Self-limiting by design — cost only recurs for a given page
  until its first successful regeneration.
- **Code:** `base44/functions/reflectizAgent/entry.ts`, the INIT opener path.
  The call+parse+validate logic was extracted into a local `runOpenerAttempt()`
  so both the first attempt and the retry share one implementation; a
  `usedFallbackOpener` flag gates the cache-skip. `tsc --noEmit` run against
  the file: no new errors (only pre-existing environmental/type noise
  unrelated to this change, matching the same pattern already present at 5
  other unedited `callGemini` call sites in the same file).
- **Status: ✅ Done — published and live-verified 2026-09-23 (Oran published
  11:39 UTC).** Forced a clean cache-miss on 8 of the 11 originally-affected
  pages (blanked each `PageOpeners.opener` via `update_entities`, confirmed
  first via query that none had been touched by organic traffic since
  publish), then sent a live INIT request to prod for each. Result: **4 of 8
  succeeded on the retry** with real, relevant, on-topic openers; **4 of 8
  were genuine double-failures** (both the original attempt and the retry
  legitimately failed) — correctly distinguished from a broken fix by
  re-querying the cache immediately after each test.

  **Success cases (real opener now cached, `generatedAt` updated to the
  fresh test timestamp — confirms the next visitor is a free cache hit):**
  - `blog/paypal-breach-2026`: before — "Worth a closer look at this. [DORA:
    Strengthen Operational Resilience...]" (unrelated). After — "Research
    shows tracking pixels on 9 out of 14 bank websites fired without valid
    consent, sending loan data to TikTok and Google. [Bank Websites Are
    Sending Loan Data to TikTok and Google]" (genuinely related).
  - `blog/stripe-skimmer-2026`: before — "Worth a closer look at what's
    actually happening here. [Simple Web Skimming Campaign...]" (unrelated).
    After — "A payment processor became a hiding spot for theft it prevents.
    [The 7 Biggest Supply Chain Attacks of 2026]" (genuinely related).
  - `blog/bank-websites-loan-data-tracking-pixels`: before — generic "Worth a
    closer look at what's actually happening here." After — "A rogue pixel on
    a leading healthcare website compromised sensitive data. [Case Study: The
    Risks of Forgotten Pixels on Websites]" (genuinely related).
  - `blog/ai-retail-webinar`: before — generic "Worth a closer look at this."
    After — "AI-enabled supply chain attacks surged by 156% last year, and
    traditional defenses are falling short. [CISO's Expert Guide To AI Supply
    Chain Attacks]" (genuinely related).

  **Legitimate double-failure cases (both attempts failed honestly — NOT a
  sign the fix is broken):** `blog/javascript-obfuscation`, `blog/jscrambler-
  npm-package-compromise`, `blog/ibm-cost-of-a-data-breach-report-2026`,
  `blog/disney-ccpa-fine-biggest-so-far` all still returned a generic
  fallback sentence to the test visitor. Confirmed this is the *designed*
  behavior, not a bug: re-querying `PageOpeners` for all 4 immediately after
  showed `opener` still blank (the value I forced before testing) and
  `generatedAt` completely unchanged from before the test — proving
  `upsertPageOpener` was never called for these rows, i.e. the cache-skip
  logic fired correctly. The next real visitor to any of these 4 pages gets
  a fresh attempt (with its own retry), not the same locked-in bad result —
  the exact self-healing behavior this fix was built for.

  bubbleText was correct and unchanged (curated) in all 8 cases throughout,
  confirming the original bug's other half was never in question.

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
**Status: ✅ Done — both resolved**

- Sep 14 proposal: reviewed and **rejected** 2026-09-17.
- Sep 9 proposal: reviewed and **rejected** 2026-09-22 (confirmed via direct
  query: `status: "rejected"`, `updated_date: 2026-09-22`). This is the one
  that would have silently deleted three working conversation rules
  (repeated-off-topic handling, the financial-services page recommendation,
  the Sucuri/WAF competitor-objection script) — correctly rejected, not
  approved as-is. Live `reflectizAgent` prompt is unaffected by either
  proposal.

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
**Status: 🔴 Open — re-diagnosed 2026-09-22, same conclusion holds**

Re-tested after the `clientImpressionId` exact-row-targeting fix (2026-08-30)
and today's AbortController fix (item #3a). Clean week (Sep 15–22, n=8,416):
dismissed 0.51%, expired 28.34%, abandoned 43.25%, no-signal 30.32%, opened
0.71% — matches the original diagnosis (abandoned ~41–43%) within normal
week-to-week variance. Expired median `timeVisibleMs` now measures exactly
25.0s, matching the real hide-timer (confirmed live in widget source), not
the ~3.1s bug artifact — confirming the tracking fixes made the data
trustworthy, and confirming the outcome itself is genuinely unchanged.
Abandonment concentrates on blog (55%) and landing pages (18%), consistent
with a content/relevance problem, not a timing-duration one. **Verdict:
Phase 2b (timing/trigger redesign) is not justified by this data — no
design proposed this session, per scope. Effort should stay on content
quality (items #1, #12, #13), weighted toward blog/landing-page content.**

## 17. Open rate vs. target
**Status: 🟡 Tracking, behind pace as of last measurement**

Target: 5× August's ~0.2% baseline → ~1.0%. Sep 1–16 impressions-weighted
average: ~0.35%, flat across the window with no upward trend visible. At
that pace the full month would land well under target — this is a KPI to
keep watching each reporting cycle, not a single fix to ship.

