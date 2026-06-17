import { createClientFromRequest } from "npm:@base44/sdk@0.8.25";

const HUB_PAGES = [
  "https://www.reflectiz.com/blog/",
  "https://www.reflectiz.com/learning-hub/",
  "https://www.reflectiz.com/industries/",
  "https://www.reflectiz.com/events/",
  "https://www.reflectiz.com/customers/",
  "https://www.reflectiz.com/use-cases/",
];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user || user.role !== "admin") {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const targetCategories = body.categories || ["retail", "financial", "healthcare"];
    const batchSize = body.batchSize ?? 5;
    const offset = body.offset ?? 0;

    // Fetch all records
    let all = [];
    let skip = 0;
    while (true) {
      const page = await base44.asServiceRole.entities.WebsiteContent.list("created_date", 200, skip);
      if (!page || page.length === 0) break;
      all = all.concat(page);
      if (page.length < 200) break;
      skip += 200;
    }

    const toReset = all.filter(r =>
      r.categories &&
      r.categories.some(c => targetCategories.includes(c)) &&
      !HUB_PAGES.includes((r.pageUrl || "").replace(/\/$/, "") + "/")
    );

    const total = toReset.length;
    const batch = toReset.slice(offset, offset + batchSize);
    const hasMore = offset + batchSize < total;
    const nextOffset = hasMore ? offset + batchSize : null;

    let succeeded = 0;
    let failed = 0;

    for (const r of batch) {
      try {
        await base44.asServiceRole.entities.WebsiteContent.update(r.id, { categories: [] });
        succeeded++;
        // Small delay between writes
        await new Promise(res => setTimeout(res, 300));
      } catch (err) {
        console.error(`Failed to reset ${r.pageUrl}: ${err.message}`);
        failed++;
      }
    }

    return Response.json({
      total_to_reset: total,
      offset,
      batch_size: batchSize,
      processed: batch.length,
      succeeded,
      failed,
      hasMore,
      nextOffset,
      message: hasMore ? `Call again with offset=${nextOffset} to continue.` : "All targeted records reset.",
    });

  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
});