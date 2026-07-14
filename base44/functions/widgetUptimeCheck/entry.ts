import { createClientFromRequest } from "npm:@base44/sdk@0.8.38";

const WIDGET_URL = "https://secure-convo-float.lovable.app/api/public/widget.js";
const DASHBOARD_URL = "https://reflect-web-wise.base44.app/AgentDashboard";
const REQUIRED_MARKER = "reflectizNativeWidgetLoaded";
const MIN_BODY_LENGTH = 10000;

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Perform the fetch check
    let status = 0;
    let body = "";
    let failureReason = "";

    try {
      const res = await fetch(WIDGET_URL, { method: "GET" });
      status = res.status;
      body = await res.text();

      if (status !== 200) {
        failureReason = `HTTP status ${status}`;
      } else if (body.length < MIN_BODY_LENGTH) {
        failureReason = `body length ${body.length} (below ${MIN_BODY_LENGTH})`;
      } else if (!body.includes(REQUIRED_MARKER)) {
        failureReason = `body missing "${REQUIRED_MARKER}" marker`;
      }
    } catch (e) {
      status = 0;
      failureReason = `fetch threw: ${e.message}`;
    }

    const isHealthy = !failureReason;

    // Load previous state
    const existing = await base44.asServiceRole.entities.WidgetStatusState.list("-lastCheckedAt", 1);
    const prev = existing?.[0];
    const prevStatus = prev?.lastStatus ?? "healthy";

    const SLACK_WEBHOOK_URL = Deno.env.get("SLACK_WEBHOOK_URL");

    // State transition: was healthy, now unhealthy -> alert down
    if (!isHealthy && prevStatus !== "unhealthy") {
      if (SLACK_WEBHOOK_URL) {
        const text = `:rotating_light: *Athena widget DOWN* — ${WIDGET_URL} returned status ${status}, body length ${body.length}. The chat widget is not loading on reflectiz.com. <${DASHBOARD_URL}|View Dashboard>`;
        await fetch(SLACK_WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        }).catch((e) => console.error("Slack DOWN alert failed:", e.message));
      }
    }

    // State transition: was unhealthy, now healthy -> alert recovered
    if (isHealthy && prevStatus === "unhealthy") {
      if (SLACK_WEBHOOK_URL) {
        const text = `:white_check_mark: *Athena widget recovered* — ${WIDGET_URL} is back online (status ${status}, body length ${body.length}). <${DASHBOARD_URL}|View Dashboard>`;
        await fetch(SLACK_WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        }).catch((e) => console.error("Slack RECOVERED alert failed:", e.message));
      }
    }

    // Persist the new state
    const newState = {
      lastStatus: isHealthy ? "healthy" : "unhealthy",
      lastCheckedAt: new Date().toISOString(),
      lastFailureReason: isHealthy ? "" : failureReason,
    };

    if (prev) {
      await base44.asServiceRole.entities.WidgetStatusState.update(prev.id, newState);
    } else {
      await base44.asServiceRole.entities.WidgetStatusState.create(newState);
    }

    return Response.json({
      healthy: isHealthy,
      status,
      bodyLength: body.length,
      failureReason: failureReason || null,
      prevStatus,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});