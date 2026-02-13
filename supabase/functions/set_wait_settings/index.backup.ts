// supabase/functions/set_wait_settings/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ADMIN_TOKEN = Deno.env.get("ADMIN_TOKEN") ?? "";
const SUPABASE_URL = Deno.env.get("PROJECT_URL") ?? "";
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
    const paused = Boolean(body?.paused);
    const pauseMessage =
      typeof body?.pause_message === "string" ? body.pause_message : null;

    // Update the SINGLE row in kitchen_wait_settings (id=1)
    const { data, error } = await supabase
      .from("kitchen_wait_settings")
      .update({
        paused,
        pause_message: pauseMessage,
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1)
      .select("id, paused, pause_message, normal_minutes, busy_minutes, very_busy_minutes, updated_at")
      .single();

    if (error) return json(500, { error: error.message });

    return json(200, { ok: true, ...data });
  } catch (e) {
    return json(500, { error: String(e?.message ?? e) });
  }
});
