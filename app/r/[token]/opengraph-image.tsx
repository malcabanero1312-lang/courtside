import { ImageResponse } from "next/og";
import { getPortalData, portalWhen } from "@/lib/portal";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Your tennis session";

function Check() {
  return (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#12392c" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.5 12.5 9.5 17.5 19.5 6.5" />
    </svg>
  );
}

function Ball() {
  return (
    <svg width="300" height="300" viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="46" fill="#d7e34b" />
      <path d="M12 26 C 34 38, 34 62, 12 74" fill="none" stroke="#12392c" strokeWidth="4" strokeLinecap="round" />
      <path d="M88 26 C 66 38, 66 62, 88 74" fill="none" stroke="#12392c" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

export default async function Image({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const page = await getPortalData(token);
  const when = portalWhen(page);
  const color = /^#[0-9a-fA-F]{6}$/.test(page.brand_color ?? "") ? (page.brand_color as string) : "#12392c";
  const answerable = page.found && page.state === "open";
  const location = [page.venue, page.court].filter(Boolean).join(" · ");

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: color,
          color: "#ffffff",
          padding: "56px 64px",
          position: "relative",
          fontFamily: "sans-serif"
        }}
      >
        <div style={{ position: "absolute", right: -40, top: 150, display: "flex", opacity: 0.95 }}>
          <Ball />
        </div>

        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: 860 }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 28, color: "#d7e34b", letterSpacing: 2, textTransform: "uppercase" }}>
              {page.org_name ?? "Courtside"}
            </div>
            <div style={{ display: "flex", fontSize: 58, fontWeight: 700, marginTop: 18, lineHeight: 1.1 }}>
              {page.found ? `Hi ${page.student_first_name || "there"}, your tennis session` : "Your tennis session"}
            </div>
            {page.found ? (
              <div style={{ display: "flex", flexDirection: "column", marginTop: 26 }}>
                <div style={{ display: "flex", fontSize: 46, fontWeight: 700, color: "#ffffff" }}>{when.day}</div>
                <div style={{ display: "flex", fontSize: 38, color: "#cfe0d7", marginTop: 6 }}>{when.time}</div>
                <div style={{ display: "flex", fontSize: 30, color: "#cfe0d7", marginTop: 14 }}>
                  {[page.coach ? `Coach ${page.coach}` : null, location || null].filter(Boolean).join("  ·  ")}
                </div>
              </div>
            ) : null}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                background: "#d7e34b",
                color: "#12392c",
                fontSize: 38,
                fontWeight: 700,
                padding: "20px 38px",
                borderRadius: 999
              }}
            >
              <Check />
              {answerable ? "Tap to confirm" : "Tap to view booking"}
            </div>
            {answerable ? (
              <div
                style={{
                  display: "flex",
                  fontSize: 30,
                  color: "#ffffff",
                  padding: "18px 30px",
                  borderRadius: 999,
                  border: "3px solid rgba(255,255,255,0.45)"
                }}
              >
                or change time
              </div>
            ) : null}
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
