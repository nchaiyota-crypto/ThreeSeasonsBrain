export type GetWaitStatusResponse = {
  ok: boolean
  status: "normal" | "busy" | "very_busy"
  minutes: number | null
  effective_minutes: number              // ✅ add this
  paused: boolean | null
  pause_message: string | null
  normal_minutes: number
  busy_minutes: number
  very_busy_minutes: number
  wait_updated_at: string
  settings_updated_at: string
}

export async function fetchWaitStatus(): Promise<GetWaitStatusResponse> {
  const res = await fetch("/api/wait-status?t=" + Date.now(), {
    method: "GET",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}