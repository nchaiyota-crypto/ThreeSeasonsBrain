// supabase/functions/set_wait_status/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ADMIN_TOKEN = Deno.env.get("ADMIN_TOKEN") ?? "";
const SUPABASE_URL = Deno.env.get("PROJECT_URL") ?? ""; // <-- set in secrets
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  try {
    if (req.method !== "POST") return json(405, { error: "Method not allowed" });

    // --- Auth: admin token header ---
    const token = req.headers.get("x-admin-token") ?? "";
    if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) {
      return json(401, { error: "Unauthorized" });
    }

    if (!SUPABASE_URL) return json(500, { error: "Missing PROJECT_URL secret" });
    if (!SUPABASE_SERVICE_ROLE_KEY) return json(500, { error: "Missing SUPABASE_SERVICE_ROLE_KEY secret" });

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const body = await req.json().catch(() => ({}));
    const status = body?.status as string | undefined;
    const minutesOverride = body?.minutes as number | undefined;

    if (!status || !["normal", "busy", "very_busy"].includes(status)) {
      return json(400, { error: "Invalid status. Use normal|busy|very_busy." });
    }

    // --- Read settings (single row id=1) ---
    const { data: settings, error: settingsErr } = await supabase
      .from("kitchen_wait_settings")
      .select("paused, pause_message, normal_minutes, busy_minutes, very_busy_minutes")
      .eq("id", 1)
      .maybeSingle();

    if (settingsErr) return json(500, { error: settingsErr.message });
    if (!settings) return json(500, { error: "kitchen_wait_settings row id=1 missing" });

    // --- If paused, still allow updating status? (We’ll allow it, but return paused flag) ---
    let minutes =
      typeof minutesOverride === "number" && minutesOverride >= 0
        ? Math.round(minutesOverride)
        : status === "normal"
        ? settings.normal_minutes
        : status === "busy"
        ? settings.busy_minutes
        : settings.very_busy_minutes;

    // --- Update single-row kitchen_wait_status (uuid id = 000...001) ---
    const rowId = "00000000-0000-0000-0000-000000000001";

    const { data: updated, error: upErr } = await supabase
      .from("kitchen_wait_status")
      .update({ status, minutes, updated_at: new Date().toISOString() })
      .eq("id", rowId)
      .select("id, status, minutes, updated_at")
      .single();

    if (upErr) return json(500, { error: upErr.message });

    return json(200, {
      ok: true,
      paused: settings.paused,
      pause_message: settings.pause_message,
      ...updated,
    });
  } catch (e) {
    return json(500, { error: String(e?.message ?? e) });
  }
});
