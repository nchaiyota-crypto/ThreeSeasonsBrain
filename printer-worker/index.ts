// printer-worker.ts
import "dotenv/config";
import express from "express";
import cors from "cors";
import { spawn } from "node:child_process";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = Number(process.env.WORKER_PORT || 8787);

// ✅ Put your exact CUPS printer names here
const PRINTER_KITCHEN = process.env.PRINTER_KITCHEN || "StarTSP100";
const PRINTER_RECEIPT = process.env.PRINTER_RECEIPT || "StarTSP100-Front"; // set later

console.log("🖨 Kitchen printer:", PRINTER_KITCHEN);
console.log("🖨 Receipt printer:", PRINTER_RECEIPT);

// ---- 1-at-a-time print queue (VERY IMPORTANT) ----
let queue = Promise.resolve();
function enqueue(job: () => Promise<void>) {
  queue = queue.then(job).catch((e) => {
    console.error("❌ Print job failed:", e?.message || e);
  });
  return queue;
}

function doPrint(printerName: string, payload_text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("/usr/bin/lp", ["-d", printerName], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let out = "";
    let err = "";

    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));

    child.on("error", (e) => reject(e));
    child.on("close", (code) => {
      if (code === 0) return resolve();
      reject(new Error(`lp failed (code ${code}): ${err || out}`));
    });

    child.stdin.write(payload_text);
    child.stdin.end();
  });
}

// ---- Routes ----
app.get("/health", (_req, res) => res.json({ ok: true }));

/**
 * POST /print
 * body: { payload_text: string, target?: "kitchen" | "receipt" }
 */
app.post("/print", (req, res) => {
  const payload_text = String(req.body?.payload_text ?? "");
  const target = String(req.body?.target ?? "kitchen");

  const printerName = target === "receipt" ? PRINTER_RECEIPT : PRINTER_KITCHEN;

  console.log("📩 /print HIT:", { target, printerName, preview: payload_text.slice(0, 80) });
  res.json({ ok: true });

  enqueue(async () => {
    await doPrint(printerName, payload_text);
    console.log("✅ Printed via CUPS:", printerName);
  });
});

app.listen(PORT, () => {
  console.log(`🖨 printer-worker listening on http://localhost:${PORT}`);
});