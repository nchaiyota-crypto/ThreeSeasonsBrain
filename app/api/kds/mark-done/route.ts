import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function must(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export async function POST(req: Request) {
  const form = await req.formData();
  const ticketId = String(form.get("ticketId") || "");

  if (!ticketId) {
    return NextResponse.json({ error: "Missing ticketId" }, { status: 400 });
  }

  const supabase = createClient(
    must("NEXT_PUBLIC_SUPABASE_URL"),
    must("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } }
  );

  // 1) Read current status
  const { data: ticket, error: readErr } = await supabase
    .from("kds_tickets")
    .select("status")
    .eq("id", ticketId)
    .single();

  if (readErr) {
    return NextResponse.json({ error: readErr.message }, { status: 500 });
  }

  const currentStatus = ticket?.status;

  // 2) Decide next status
  let nextStatus: "new" | "in_progress" | "done" = "done";
  if (currentStatus === "new") nextStatus = "in_progress";
  if (currentStatus === "in_progress") nextStatus = "done";

  // 3) Update
  const { error: updErr } = await supabase
    .from("kds_tickets")
    .update({ status: nextStatus })
    .eq("id", ticketId);

  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  return NextResponse.redirect(new URL("/kds?done=1", req.url));
}