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

## 20. Full infrastructure review — 2026-09-24
**Status: 🔴 Open — 3 new findings need decisions, rest of the codebase is healthy**

Exhaustive, section-by-section technical audit (repo integrity, syntax/type
health across all 12 functions, live regression-check of every WORK_PLAN
item, entity schema cross-reference, dead-code sweep, secret hygiene,
curated-content/cache health, scheduled-automation integrity). Full detail
in that session's chat report; summary here, ranked by severity:

1. **[RESOLVED 2026-09-24] Slack threading (item #10) was broken for
   real sessions — fixed, and it turned out to be two separate bugs, not
   one.** Root cause #1: 3 `slackAlert` HTTP calls fired without `await`
   (same class as item #3a's Gemini fix, never applied here) — fixed via
   `waitUntil()`. Root cause #2, found only by live-testing fix #1 and
   not assuming success: `firstMessageAlertSent` and `slackMessageTs`
   were never declared in `Conversations.jsonc`'s schema, so both were
   silently dropped on every write regardless of await timing — this,
   not the unawaited fetch, was the real answer to the long-unconfirmed
   `firstMessageAlertSent` mystery from items #2/#6/#18. Both fixed,
   live-verified with real Slack thread data (see item #10 for full
   detail). One caveat: verified via 5 deliberate test sessions, not yet
   against genuinely organic traffic (none occurred in the few minutes
   since publish) — worth a quick spot-check next visit.
2. **[MEDIUM, new] A 3rd `PendingConfigChanges` proposal has sat
   unreviewed since 2026-09-23** (item #7 only covered the first two).
   Diff reviewed: looks additive/safe (a new content-driven opener rule,
   nothing removed) but this is Oran's call to approve/reject, not this
   session's.
3. **[MEDIUM, new] `WebsiteContent` has www/non-www duplicate rows**
   (at least 7 learning-hub pages) with inconsistent categories between
   duplicates — one `lockCategories:true` copy stuck permanently empty
   while a newer copy at a different URL-normalization carries real data.
   Affects the item #12 "4 known gaps, no drift" claim, which no longer
   holds cleanly.
4. **[LOW-MEDIUM, new] `crawlWebsite` function is fully orphaned** — a
   12th function (missing from this engagement's own tracking so far),
   zero callers anywhere in the codebase, no automation attached. Needs
   a keep-or-delete decision.
5. **[LOW, new] `Weekly Training Simulation` automation is inactive with
   a failed run from 2026-05-15**, never tracked anywhere until now.
6. **[LOW, new] A separate GitHub Actions daily-crawl cron was disabled
   2026-09-01** (missing secret) and never reconciled against Base44's
   own "Daily Website Crawl" workflow — unclear if genuinely redundant.
7. **[INFO] `list_entity_schemas` MCP tool is non-functional for this
   app** right now — blocked a full formal schema audit; worked around
   by sampling live rows, but Oran should know this capability is down.
8. **[INFO] Base44 publish has real propagation lag (10–40s observed)**
   this session — re-confirmed operational fact, not a new bug.

**Clean / re-confirmed, no action needed:** git repo integrity (tree
clean, local=origin exactly); syntax health across all 12 functions (no
new error patterns, only more instances of already-known loose-typing
noise); items #1, #2 (zero literal secrets app-wide), #3a (0% orphaned
Gemini calls today, re-confirmed), #3b, #8, #9 (unfurl visually
confirmed clean for the first time), #13, #18 (probe armed, today's
cron predates it so no data lost); secret/env-var cross-reference clean;
curated-bubble maps have zero duplicate keys; 8/8 sampled curated URLs
reachable.

---

## 19. Broader investigative leads for open rate / fallback rate (1.0% target)
**Status: 🔵 Queued — do not start until items #8 and #18 are resolved**

Seven untested hypotheses for what else could be affecting open rate and
fallback rate, beyond what's already been investigated (content quality,
bubble timing/duration — both already tested, see #12/#13/#16). Recorded
here so none of these get lost before they're picked up.

1. **Device type (mobile vs. desktop) — highest priority, cheapest to
   check, completely unexplored.** Mobile has no auto-expire timer at all;
   desktop cuts off at 25s. Never segmented open/fallback rate by device.
   If the two populations behave very differently, we've been averaging
   them together and possibly masking a real, fixable split.
2. **Competing on-page elements** — cookie banners, exit-intent popups,
   other chat widgets on the same pages. Never checked whether Athena's
   bubble visually collides with or gets hidden behind something else,
   which would show up as "abandoned" but really means "never seen."
3. **Trigger condition (time-based vs. reading behavior)** — duration was
   ruled out (#16), but WHEN the bubble appears (a fixed 3-15s timer)
   was not. A scroll-depth or dwell-time trigger might catch genuinely
   attentive visitors instead of firing on a clock regardless of what
   they're doing.
4. **Audience quality by traffic source** — 88% of traffic is Direct +
   Organic Social, barely any Search. Never asked whether that audience
   (e.g. casual LinkedIn readers) structurally differs in buying intent
   from what small amount of Search traffic exists — no amount of better
   copy fixes a source/intent mismatch.
5. **Ad blockers / privacy browsers silently missing from our own count**
   — if a meaningful share of visitors never get an impression logged
   because their browser blocks the widget script entirely, our own
   denominator (and therefore our rate) could be systematically skewed
   in a way we can't currently see.
6. **Shared infrastructure contention beyond this codebase** — the
   Gemini/Vertex-AI quota is confirmed shared across every function in
   this app (item #3's finding). Untested: whether it's also shared with
   OTHER tenants on the same underlying Google Cloud project, which would
   explain instability with nothing to do with anything in this repo.
7. **Bot contamination in the raw impression denominator, re-examined
   properly** — an earlier rough pass suggested ~4.7% bot-like traffic.
   GA4 filters known bots by default; our own raw OpenerImpressions
   tracking may not, meaning the real, human open rate could differ
   from what's currently reported. Worth a tighter, dedicated check, not
   the rough pass done earlier.

**Recommended order once started:** #1 first (cheapest, most concrete,
answers a real question with data we already have). Scope each
subsequent one as its own small, isolated session based on what #1
finds — explicitly NOT a single combined investigation across all
seven, per this project's own standing lesson about large multi-task
sessions underperforming small isolated ones.

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
**Status: 🔴 Open — risk assessed 2026-09-24, recommendation given, awaiting decision**

Discovered while verifying item #2: `scheduledCrawl`'s `singleUrl` mode
(added for item #1's crawl-coverage fix) does not check the Authorization
header at all — a deliberately wrong key produces the identical result to
the correct one. Separately, `reflectizAgent`'s own equality check on this
same key is currently dead code, since `SOFT_LAUNCH_GATE = false` makes
`gateAllows()` return true before that check is ever reached.

### Finding 1 — `scheduledCrawl` has no inbound auth check anywhere (not just `singleUrl`)

Grepped the entire file: the only use of `BASE44_INTERNAL_API_KEY` is
**outbound** (as a Bearer token when `scheduledCrawl` calls other functions).
There is no inbound header check anywhere in `Deno.serve`'s handler — this
is broader than just the `singleUrl` branch: the main sitemap-wide crawl
path (bigger blast radius: many pages per call) is equally unauthenticated.

**Blast radius if reached by anyone, not just internal calls:** `crawlPage()`
takes the caller-supplied URL with **no domain restriction**, does a
server-side `fetch()` to it (SSRF: the app's own infra can be made to issue
requests to an attacker-chosen destination), then — if the fetch succeeds —
runs it through Gemini categorization and **writes it into `WebsiteContent`**.
That entity feeds directly into what real visitors see (RAG search, item #8;
opener/bubbleText candidate selection, items #3/#12/#16) — meaning an
unauthenticated caller could inject fabricated content that Athena later
recommends to real site visitors. This is a content-integrity/trust risk,
not merely a resource-waste one, plus it consumes Gemini quota (compounding
item #3's instability) with no rate limiting anywhere.

**Reachability:** not tested directly this session (stayed read-only), but
very high confidence it's reachable from the public internet with no
platform-level gate — established all session by directly, repeatedly
calling `reflectizAgent`'s identically-deployed/exposed endpoint with zero
auth of any kind and getting real responses every time. `scheduledCrawl` is
published the same way.

**Recommendation: option (a) — add real enforcement, not "acceptable as-is".**
The content-integrity angle (poisoned data reaching real visitors) makes
this qualitatively worse than a typical low-risk internal-endpoint gap.
Proposed change: at the very top of `scheduledCrawl`'s `Deno.serve` handler,
before parsing the body or branching into `singleUrl`/sitemap-crawl, verify
`req.headers.get("Authorization") === \`Bearer ${BASE44_INTERNAL_API_KEY}\``
and return 401 if not — gating the whole function, mirroring the Bearer-
token-equality pattern already used correctly elsewhere in this codebase.
**Open question to resolve before implementing:** does Base44's own "Daily
Website Crawl" scheduled-workflow trigger send this Authorization header
automatically? If not, this fix would break the legitimate nightly cron
job — needs confirming, not assuming, before this ships.

### Finding 2 — `reflectizAgent`'s dead `x-athena-prewarm` check

`SOFT_LAUNCH_GATE`'s own comment states its sole purpose: restrict Athena
to office/owner IPs before public launch. It has been `false` (fully public)
for this entire multi-week engagement of real production traffic — that
job is conclusively done, with no evidence anywhere of a planned
reactivation for some other future feature.

However, `gateAllows()`/the IP-allowlist mechanism itself is generic,
reusable infrastructure, not single-purpose throwaway code — and it's
provably zero-risk to leave as-is, since it's genuinely unreachable while
`SOFT_LAUNCH_GATE = false`. The one piece that's genuinely, permanently
obsolete (not just dormant) is specifically the `x-athena-prewarm` /
`BASE44_INTERNAL_API_KEY` equality check: grepped the whole codebase —
no caller anywhere sends this header. The prewarm pipeline it was built for
was ported directly into `scheduledCrawl` instead of calling `reflectizAgent`
over HTTP, so even reactivating `SOFT_LAUNCH_GATE` tomorrow would never let
any real caller satisfy this specific check.

**Recommendation: option (c), split.** Leave `SOFT_LAUNCH_GATE` and the
IP-allowlist gate mechanism alone — correct, reusable dormant logic, not a
risk. The `x-athena-prewarm` line specifically can be removed whenever
convenient as genuinely-orphaned dead code — low priority, cosmetic only,
no security implication either way since it's unreachable now.

**2026-09-24: Oran approved Finding 1's direction. Blocking question NOT yet
resolvable from config — shipped the safe empirical diagnostic instead.**

Tried to confirm via `base44 workflows list` whether the "Daily Website
Crawl" scheduled trigger sends a matching `Authorization` header
automatically. Hit a fresh device-code login wall in this session's sandbox
(credentials don't persist across sessions — established pattern all
engagement) and `list_entity_schemas` also errored for unrelated reasons;
neither was pursued by interrupting Oran for a login click, since workflow
scheduling config likely wouldn't expose per-request header details anyway
even if reached.

**Shipped instead (logging-only, no enforcement yet):** added a temporary,
non-rejecting diagnostic at the very top of `scheduledCrawl`'s handler that
logs whether an `Authorization` header is present and whether it matches
`BASE44_INTERNAL_API_KEY`, plus whether the call is a `singleUrl` request
(those already carry the correct header today, since `reflectizAgent`'s own
`fireScheduledCrawlSingleUrl` sets it — confirmed in code). The one open
unknown is specifically the **cron-triggered main crawl call** (`singleUrl:
false`), which this probe will capture directly. **`tsc --noEmit`: clean,
same pre-existing error pattern as before, no new issues.** Bundled Finding
2's cosmetic fix into the same publish: deleted the dead `x-athena-prewarm`
check from `reflectizAgent`'s `gateAllows()`.

**Published 2026-09-24 11:33 UTC, fully live-verified same day.** Three
checks, all confirmed directly against prod:

1. Unauthenticated call (no `Authorization` header) to `scheduledCrawl` →
   `HTTP 200`, not rejected. Wrong-key call (`Bearer definitely-the-wrong-
   key-12345`) → also `HTTP 200`. Confirms no enforcement shipped yet, by
   design — exactly as intended at this stage.
2. **Diagnostic probe confirmed firing correctly via direct prod log read**
   (CLI login completed with Oran's approval): both test calls appear
   exactly as expected —
   `{"headerPresent":false,"matchesInternalKey":false,"singleUrl":true}` and
   `{"headerPresent":true,"matchesInternalKey":false,"singleUrl":true}`.
3. A real `reflectizAgent` INIT call still returns a normal, ungated reply
   (not the `{blocked:true}` shape) — confirms deleting the dead
   `x-athena-prewarm` line didn't change `gateAllows()`'s behavior;
   `SOFT_LAUNCH_GATE=false` still short-circuits it to `true` exactly as
   before.

CLI/log access now works for this app (logged in as marketing@reflectiz.com)
— this same access is what tomorrow's real check will use, so that path is
confirmed ready, not just theoretical.

**Real enforcement is still explicitly NOT part of this ship** — an
unauthenticated call to `scheduledCrawl` still succeeds today, by design,
until tomorrow's cron log check informs the real fix.

**Follow-up required, timing matters:** the nightly "Daily Website Crawl"
runs ~03:00 UTC. Prod log retention is same-day only (established earlier
this engagement) — the diagnostic's log line must be checked **on
2026-09-25, after ~03:00 UTC but before the day rolls over**, or this
run's evidence is lost and another full day's wait is needed. Once that
log is read: if the cron already sends the correct header, add the real
401-rejecting check immediately (safe, per Oran's approval already given).
If it doesn't, escalate to Oran — either find and set the header in
Base44's workflow config, or accept a documented gap until that's done.
Remove this temporary logging block once real enforcement ships either way.

**Also flagged, unconfirmed:** a test conversation's `firstMessageAlertSent`
field was unexpectedly absent from the stored record despite the code
setting it unconditionally on conversation creation — noted as a new,
unverified lead from the same investigation, not yet looked into.

**2026-09-24 (later same day) — self-reporting added, manual-check risk
removed.** Instead of relying on someone remembering to pull same-day-only
logs in a narrow window tomorrow, the diagnostic now posts its own result
directly to `#athena-chat` (reusing the proven `chat.postMessage` + unfurl-
suppression pattern from item #9) every time `scheduledCrawl` is invoked,
awaited so it can't silently drop as post-response work (the same lesson
from item #3a). Message states `headerPresent`, `matchesInternalKey`, and
`singleUrl` plainly. Found and fixed a real bug during verification: the
first version only caught network-level fetch failures, not Slack's own
logical `ok:false` response body — could have silently "succeeded" while
never actually posting. Corrected and re-verified: message confirmed
landing in Slack, correctly formatted, no unfurl card, across three
separate live tests. One remaining cosmetic gap, accepted rather than
chased further: the live function is still running a slightly more verbose
debug-logging version than the final intended one (functionally identical,
same Slack-posting behavior confirmed three times) — not worth another
publish cycle for a log-verbosity difference alone, especially since this
whole diagnostic block gets deleted once real enforcement ships anyway.

**Status now: tomorrow's cron-triggered main crawl call (`singleUrl:
false`) will self-report to Slack automatically — no manual log-pulling
or timing risk remains.** Once that message arrives (~03:00 UTC, 2026-09-25
onward), read `headerPresent`/`matchesInternalKey` directly and proceed:
correct header present → ship real 401 enforcement immediately (already
approved); missing/wrong → escalate for a decision on fixing Base44's
workflow config vs. accepting a documented gap.

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
**Status: ✅ Done — fixed, published, and live-verified 2026-09-24**

Found during the fallback-rate investigation: a third instance of the same
unbounded-scan shape (fixed for item #3 above) exists in a RAG-style
keyword-search helper (`reflectizAgent/entry.ts`, ~line 403, inside
`searchWebsiteContent()`), used during actual chat-message handling (not the
INIT/opener path item #3 covers). Same risk under load, explicitly out of
scope when first found — revisited and closed this session.

Applied the identical proven fix from the other two instances: wrapped the
`WebsiteContent.list("-lastScanned", 500)` call in a `Promise.race` against a
4000ms timeout resolving `null`, then `if (!rawPages) return [];` — reusing
`searchWebsiteContent`'s own pre-existing empty-result path (already handled
gracefully downstream by `formatRetrievedPages()`, which renders `""` for an
empty array). No new fallback behavior invented, no caller changes needed.
`tsc --noEmit` showed the identical pre-existing error set as before the
edit (only line numbers shifted), confirming no new issues introduced.

Published, then live-verified with a real chat message exercising this exact
path ("Can you tell me more about magecart supply chain attacks and web
skimming risks?" against a fresh test session): the RAG search completed
within budget and returned a correct, relevant reply citing genuinely related
content (`blog/supply-chain-anz/`), confirming the timeout wrapper didn't
break the search — it still returns real results under normal conditions and
would now fail fast into the existing empty-RAG-context path instead of
hanging the whole chat request if the scan were ever slow.

All three unbounded-scan instances flagged since the fallback-rate
investigation are now closed: the two in the INIT/opener path (item #3) and
this one in the chat-message RAG path.

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
**Status: ✅ Done — regressed and re-fixed 2026-09-24, live-verified with real threading**

Session activity posts as one top-level message per session with
subsequent events threaded as replies (`thread_ts` / `Conversations.
slackMessageTs`), instead of a flood of separate top-level posts per
visitor. Re-confirmed live multiple times through 2026-09-17.

**Regression found 2026-09-24** (item #20's infrastructure review):
confirmed broken for real sessions — 2 real recent multi-turn sessions
posted as 3 and 6 separate top-level messages instead of one threaded
conversation. **Two independent root causes, both fixed:**

1. `reflectizAgent`'s 3 `slackAlert` HTTP calls (`new_conversation`,
   conversion, first-message) were fired without `await`, right before
   the function's own `return` — functionally identical to post-response
   background work, the same failure class item #3a proved and fixed for
   Gemini calls, never applied here. **Fixed** by wrapping all 3 in
   `waitUntil()` (`import { waitUntil } from "base44:runtime"`, per
   Base44's own docs — researched, not guessed), which keeps the
   function alive for this background work without making the visitor
   wait on it. Documented as best-effort by Base44 itself, the correct
   tradeoff for a notification side-channel.
2. **A second, deeper bug found live-testing the first fix**: even when
   `slackAlert` successfully posted and correctly attempted its own
   `Conversations.update(conv.id, { slackMessageTs: ... })` write-back,
   the field never persisted — and separately, `firstMessageAlertSent`
   (set unconditionally inside an already-`await`ed `Conversations.
   create()` call, nothing to do with the Slack fetch at all) was also
   never persisting. Root cause: **neither field was ever declared in
   `base44/entities/Conversations.jsonc`'s schema** — Base44 silently
   drops any written field not in the declared schema, on every write,
   unconditionally. This fully and separately explains the long-
   unresolved `firstMessageAlertSent`-absent mystery from items #2/#6/
   #18 — it was never the same cause as the threading bug, a wrong
   assumption corrected by live testing rather than left unverified.
   **Fixed** by adding both fields to the entity schema.

**Live-verified after both fixes, real Slack data, not just field
values:** a deliberate multi-event test session (INIT-equivalent message
→ a conversion-triggering follow-up) was read back directly from
#athena-chat via `slack_read_thread`: **one top-level "New Conversation"
message, with the conversion event correctly threaded as a reply
underneath it.** `Conversations` record for that session: both
`firstMessageAlertSent: true` and `slackMessageTs` populated. Broader
sanity check: 2 more independent test sessions immediately after both
also show correct `slackMessageTs`/`firstMessageAlertSent` (5 of 5 post-
both-fixes, vs. 1 of 3 when only the `waitUntil` fix was live —
confirming the schema fix was the missing piece, not redundant). No
genuinely organic (non-test) multi-turn session had occurred yet in the
few minutes since publish, so the "sample real organic sessions" check
couldn't be done with real traffic this session — worth a quick spot
check next time this file is touched.

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

