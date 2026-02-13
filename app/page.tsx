"use client";
import Link from "next/link";
import Navbar from "./components/Navbar";
import { useEffect, useState } from "react";
import { fetchWaitStatus, type GetWaitStatusResponse } from "@/lib/waitStatus";

export default function HomePage() {
  const [paused, setPaused] = useState(false);
  const [pauseMessage, setPauseMessage] = useState("");
  const [ws, setWs] = useState<GetWaitStatusResponse | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const data = await fetchWaitStatus();

        setWs(data);

        if (data.paused) {
          setPaused(true);
          setPauseMessage(
            data.pause_message ||
              "Online ordering is temporarily paused. Please call the restaurant."
          );
        } else {
          setPaused(false);
          setPauseMessage("");
        }
      } catch {
        // fail silent — never block homepage
      }
    })();
  }, []);
  return (
    <div style={{ minHeight: "100vh", background: "#fff" }}>
      <Navbar />
      {paused && (
        <div
          style={{
            background: "#111",
            color: "#fff",
            padding: "14px 18px",
            textAlign: "center",
            fontWeight: 900,
          }}
        >
          {pauseMessage}
        </div>
      )}  
      {/* HERO */}
      <section
        style={{
          position: "relative",
          width: "100%",
          height: "72vh",
          minHeight: 520,
          background: "#111",
          overflow: "hidden",
        }}
      >
        <img
          src="/images/home/hero.jpg"
          alt="3 Seasons Thai Bistro"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            opacity: 0.92,
          }}
          onError={(e) => {
            // if hero missing, fallback to simple background
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />

        {/* dark overlay for readability */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(90deg, rgba(0,0,0,0.75), rgba(0,0,0,0.25))",
          }}
        />

        <div
          style={{
            position: "relative",
            maxWidth: 1200,
            margin: "0 auto",
            padding: "80px 18px",
            color: "#fff",
          }}
        >
          <div style={{ maxWidth: 650 }}>
            <div style={{ fontWeight: 800, opacity: 0.9, marginBottom: 10 }}>
              Best Thai Food in Oakland, CA
            </div>

            <h1 style={{ fontSize: 52, lineHeight: 1.05, margin: 0, fontWeight: 950 }}>
              Savor Every Bite of Authentic Thai Cuisine,
              <br />
              Made Fresh Daily.
            </h1>

            <p style={{ marginTop: 16, fontSize: 18, opacity: 0.92, lineHeight: 1.5 }}>
              A local spot for bold flavors, comfort classics, and house specials —
              crafted with care, ready for pickup.
            </p>

            {ws && (
              <div
                style={{
                  marginTop: 16,
                  padding: "10px 12px",
                  borderRadius: 12,
                  background: "rgba(255,255,255,0.12)",
                  border: "1px solid rgba(255,255,255,0.18)",
                  maxWidth: 520,
                  backdropFilter: "blur(6px)",
                }}
              >
                {ws.paused ? (
                  <>
                    <div style={{ fontWeight: 900 }}>Online ordering is paused</div>
                    <div style={{ opacity: 0.9, marginTop: 4 }}>
                      {ws.pause_message || "Please call the restaurant or try later."}
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ fontWeight: 900 }}>
                      Estimated wait: {ws.minutes ?? 0} minutes
                    </div>
                    <div style={{ opacity: 0.9, marginTop: 4 }}>
                      Kitchen status:{" "}
                      {ws.status === "normal"
                        ? "Normal"
                        : ws.status === "busy"
                        ? "Busy"
                        : "Very Busy"}
                    </div>
                  </>
                )}
              </div>
            )}

            <div style={{ display: "flex", gap: 12, marginTop: 20, flexWrap: "wrap" }}>
              <Link
                href={ws?.paused ? "#" : "/menu"}
                aria-disabled={ws?.paused ? "true" : "false"}
                onClick={(e) => {
                  if (ws?.paused) e.preventDefault();
                }}
                style={{
                  height: 44,
                  padding: "0 18px",
                  borderRadius: 12,
                  background: "#fff",
                  color: "#111",
                  display: "inline-flex",
                  alignItems: "center",
                  fontWeight: 950,
                  textDecoration: "none",
                  opacity: ws?.paused ? 0.6 : 1,
                  pointerEvents: ws?.paused ? "none" : "auto",
                }}
              >
                Order online →
              </Link>

              <a
                href="#story"
                style={{
                  height: 44,
                  padding: "0 18px",
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.35)",
                  color: "#fff",
                  display: "inline-flex",
                  alignItems: "center",
                  fontWeight: 900,
                  textDecoration: "none",
                }}
              >
                Our story
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* WELCOME SECTION */}
      <section id="story" style={{ padding: "54px 18px" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 28, alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 44, fontWeight: 950, marginBottom: 10 }}>Welcome to 3 Seasons Thai Bistro</div>
              <p style={{ fontSize: 16, lineHeight: 1.7, color: "#333", margin: 0 }}>
                Located in the heart of Oakland, we serve flavorful Thai dishes that are fresh,
                comforting, and easy to enjoy. Whether you’re craving curry, noodles, or house specials —
                we’ve got you covered.
              </p>

              <div style={{ display: "flex", gap: 10, marginTop: 18, flexWrap: "wrap" }}>
                <a
                  href="#menu"
                  style={{
                    height: 42,
                    padding: "0 14px",
                    borderRadius: 12,
                    border: "1px solid #ddd",
                    background: "#fff",
                    display: "inline-flex",
                    alignItems: "center",
                    fontWeight: 900,
                    textDecoration: "none",
                    color: "#111",
                  }}
                >
                  View Menu
                </a>

                <a
                  href="#catering"
                  style={{
                    height: 42,
                    padding: "0 14px",
                    borderRadius: 12,
                    border: "1px solid #ddd",
                    background: "#fff",
                    display: "inline-flex",
                    alignItems: "center",
                    fontWeight: 900,
                    textDecoration: "none",
                    color: "#111",
                  }}
                >
                  Catering
                </a>
              </div>
            </div>

            {/* Right side "card" like Owner */}
            <div
              style={{
                border: "1px solid #eee",
                borderRadius: 16,
                padding: 18,
                background: "#fafafa",
              }}
            >
              <div style={{ fontWeight: 950, marginBottom: 10 }}>Hours</div>
              <div style={{ color: "#333", lineHeight: 1.7 }}>
                <div>Mon–Thu: 11:00 AM – 9:00 PM</div>
                <div>Fri–Sat: 11:00 AM – 10:00 PM</div>
                <div>Sun: 12:00 PM – 9:00 PM</div>
              </div>

              <div style={{ marginTop: 14, fontWeight: 950, marginBottom: 8 }}>Location</div>
              <div style={{ color: "#333", lineHeight: 1.7 }}>
                1506 Leimert Blvd
                <br />
                Oakland, CA 94602
              </div>

              <div style={{ marginTop: 16 }}>
                <Link
                  href="/menu"
                  style={{
                    width: "100%",
                    height: 44,
                    borderRadius: 12,
                    background: "#111",
                    color: "#fff",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: 950,
                    textDecoration: "none",
                  }}
                >
                  Order Now →
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* SIMPLE FOOTER */}
      <footer style={{ borderTop: "1px solid #eee", padding: "26px 18px", background: "#fff" }}>
        <div
          style={{
            maxWidth: 1200,
            margin: "0 auto",
            display: "flex",
            justifyContent: "space-between",
            gap: 16,
            flexWrap: "wrap",
            color: "#444",
          }}
        >
          <div style={{ fontWeight: 900 }}>© {new Date().getFullYear()} Union Thais LLC</div>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            <a href="#menu" style={{ color: "#444", textDecoration: "none" }}>
              Menu
            </a>
            <a href="#catering" style={{ color: "#444", textDecoration: "none" }}>
              Catering
            </a>
            <a href="#story" style={{ color: "#444", textDecoration: "none" }}>
              Our Story
            </a>
            <a href="#giftcards" style={{ color: "#444", textDecoration: "none" }}>
              Gift Cards
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}