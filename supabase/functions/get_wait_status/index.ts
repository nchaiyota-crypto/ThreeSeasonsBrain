// supabase/functions/get_wait_status/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ADMIN_TOKEN = Deno.env.get("ADMIN_TOKEN") ?? "";
const PROJECT_URL = Deno.env.get("PROJECT_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  try {
    // ✅ allow GET (and POST if you want)
    if (req.method !== "GET" && req.method !== "POST") {
      return json(405, { error: "Method not allowed" });
    }

    // ✅ admin token header
    const token = req.headers.get("x-admin-token") ?? "";
    if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) {
      return json(401, { error: "Unauthorized" });
    }

    if (!PROJECT_URL) return json(500, { error: "Missing PROJECT_URL secret" });
    if (!SUPABASE_SERVICE_ROLE_KEY) return json(500, { error: "Missing SUPABASE_SERVICE_ROLE_KEY secret" });

    const supabase = createClient(PROJECT_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Read wait status (single row uuid)
    const rowId = "00000000-0000-0000-0000-000000000001";
    const { data: ws, error: wsErr } = await supabase
      .from("kitchen_wait_status")
      .select("status, minutes, updated_at")
      .eq("id", rowId)
      .maybeSingle();

    if (wsErr) return json(500, { error: wsErr.message });
    if (!ws) return json(500, { error: "kitchen_wait_status row missing" });

    // Read pause settings (single row id=1)
    const { data: settings, error: sErr } = await supabase
      .from("kitchen_wait_settings")
      .select("paused, pause_message, normal_minutes, busy_minutes, very_busy_minutes, updated_at")
      .eq("id", 1)
      .maybeSingle();

    if (sErr) return json(500, { error: sErr.message });
    if (!settings) return json(500, { error: "kitchen_wait_settings row id=1 missing" });

    return json(200, {
      ok: true,
      status: ws.status,
      minutes: ws.minutes,
      wait_updated_at: ws.updated_at,
      paused: settings.paused,
      pause_message: settings.pause_message,
      normal_minutes: settings.normal_minutes,
      busy_minutes: settings.busy_minutes,
      very_busy_minutes: settings.very_busy_minutes,
      settings_updated_at: settings.updated_at,
    });
  } catch (e) {
    return json(500, { error: String(e?.message ?? e) });
  }
});
