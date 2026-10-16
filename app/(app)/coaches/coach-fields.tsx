import type { Coach } from "@/lib/types";

const COLORS = ["#1d5c45", "#b8552e", "#5b4bb0", "#2a6f97", "#a26a06", "#b4342b", "#4d7c0f", "#7c3aed"];

export function CoachFields({ coach, showActive }: { coach?: Partial<Coach>; showActive?: boolean }) {
  return (
    <div className="form-grid">
      <label className="field span-2">
        <span>Full name</span>
        <input className="input" name="full_name" defaultValue={coach?.full_name ?? ""} required maxLength={120} />
      </label>
      <label className="field">
        <span>Email</span>
        <input className="input" type="email" name="email" defaultValue={coach?.email ?? ""} />
        <small>Gets booking and cancellation emails.</small>
      </label>
      <label className="field">
        <span>Phone</span>
        <input className="input" name="phone" defaultValue={coach?.phone ? `+${coach.phone}` : ""} inputMode="tel" />
      </label>
      <label className="field span-2">
        <span>Specialties</span>
        <input className="input" name="specialties" defaultValue={coach?.specialties ?? ""} placeholder="Juniors, high performance, adult beginners" />
      </label>
      <label className="field">
        <span>Calendar colour</span>
        <select className="input" name="color" defaultValue={coach?.color ?? COLORS[0]}>
          {COLORS.map((color, index) => (
            <option key={color} value={color} style={{ color }}>
              ● Colour {index + 1}
            </option>
          ))}
        </select>
      </label>
      {showActive ? (
        <label className="check" style={{ alignSelf: "end", paddingBottom: 10 }}>
          <input type="checkbox" name="is_active" defaultChecked={coach?.is_active ?? true} />
          Active (can be booked)
        </label>
      ) : null}
    </div>
  );
}
