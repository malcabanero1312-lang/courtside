import type { Student } from "@/lib/types";

export function StudentFields({ student }: { student?: Partial<Student> }) {
  return (
    <div className="form-grid">
      <label className="field span-2">
        <span>Full name</span>
        <input className="input" name="full_name" defaultValue={student?.full_name ?? ""} required maxLength={120} />
      </label>
      <label className="field">
        <span>WhatsApp number</span>
        <input
          className="input"
          name="phone"
          defaultValue={student?.phone ? `+${student.phone}` : ""}
          placeholder="0917 123 4567"
          inputMode="tel"
        />
        <small>Local numbers get your country code added automatically.</small>
      </label>
      <label className="field">
        <span>Email</span>
        <input className="input" name="email" type="email" defaultValue={student?.email ?? ""} placeholder="name@email.com" />
      </label>
      <label className="field">
        <span>Parent / guardian</span>
        <input className="input" name="guardian_name" defaultValue={student?.guardian_name ?? ""} />
      </label>
      <label className="field">
        <span>Level</span>
        <select className="input" name="level" defaultValue={student?.level ?? ""}>
          <option value="">Not set</option>
          <option>Beginner</option>
          <option>Intermediate</option>
          <option>Advanced</option>
          <option>Competitive</option>
        </select>
      </label>
      <label className="field">
        <span>Prefers to be contacted by</span>
        <select className="input" name="preferred_channel" defaultValue={student?.preferred_channel ?? "whatsapp"}>
          <option value="whatsapp">WhatsApp</option>
          <option value="email">Email</option>
        </select>
      </label>
      <label className="check" style={{ alignSelf: "end", paddingBottom: 10 }}>
        <input type="checkbox" name="email_opt_in" defaultChecked={student?.email_opt_in ?? true} />
        Send email confirmations and reminders
      </label>
      <label className="check span-2">
        <input type="checkbox" name="is_regular" defaultChecked={student?.is_regular ?? false} />
        Regular student (fixed weekly schedule from the office sheet)
      </label>
      <label className="field span-2">
        <span>Notes</span>
        <textarea className="input" name="notes" defaultValue={student?.notes ?? ""} maxLength={2000} placeholder="Goals, injuries, preferred times…" />
      </label>
    </div>
  );
}
