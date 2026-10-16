import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/session";
import type { MessageTemplate } from "@/lib/types";
import { PLACEHOLDERS } from "@/lib/templates";
import { Card, Flash, PageHeader } from "@/components/ui";
import { Icon } from "@/components/icons";
import { SubmitButton } from "@/components/buttons";
import { restoreTemplates, updateTemplate } from "../actions";

export const metadata: Metadata = { title: "Message templates" };

const DESCRIPTIONS: Record<string, string> = {
  appointment_request: "Sent by an agent right after booking.",
  follow_up: "For students who haven't replied yet.",
  reminder: "A friendly reminder before the session.",
  rescheduled: "Used after moving a session to a new time.",
  student_confirmed: "Emailed to the student when the booking is confirmed.",
  student_cancelled: "Emailed to the student when staff cancel.",
  student_rescheduled: "Emailed to the student when a session is moved.",
  student_reminder: "Emailed automatically before the session.",
  staff_student_response: "Emailed to the coach and agent when a student responds.",
  staff_cancelled: "Emailed to the coach when a session is cancelled.",
  staff_rescheduled: "Emailed to the coach when a session is moved."
};

function TemplateCard({ template }: { template: MessageTemplate }) {
  return (
    <Card title={template.name} actions={<span className="small muted">{DESCRIPTIONS[template.key] ?? template.key}</span>}>
      <form action={updateTemplate} className="card-body stack">
        <input type="hidden" name="id" value={template.id} />
        <label className="field">
          <span>Name</span>
          <input className="input" name="name" defaultValue={template.name} />
        </label>
        {template.channel === "email" ? (
          <label className="field">
            <span>Subject</span>
            <input className="input" name="subject" defaultValue={template.subject ?? ""} />
          </label>
        ) : null}
        <label className="field">
          <span>Message</span>
          <textarea className="input" name="body" defaultValue={template.body} rows={10} style={{ fontFamily: "inherit" }} />
        </label>
        <div className="form-actions">
          <SubmitButton size="small" variant="primary">Save template</SubmitButton>
        </div>
      </form>
    </Card>
  );
}

export default async function TemplatesPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const { supabase, org } = await requireSession(["admin"]);
  const { data } = await supabase.from("message_templates").select("*").eq("org_id", org.id).order("channel", { ascending: false }).order("name");
  const templates = (data ?? []) as MessageTemplate[];
  const whatsapp = templates.filter((t) => t.channel === "whatsapp");
  const email = templates.filter((t) => t.channel === "email");

  return (
    <>
      <div className="row small" style={{ marginBottom: 10 }}>
        <Link href="/settings" className="muted row" style={{ gap: 4 }}>
          <Icon name="chevronLeft" size={15} /> Settings
        </Link>
      </div>
      <Flash params={params} />
      <PageHeader
        title="Message templates"
        subtitle="Write once, reuse everywhere. Placeholders like {{date}} are filled in automatically."
        actions={
          <form action={restoreTemplates}>
            <SubmitButton size="small" variant="ghost" icon="undo">Restore missing defaults</SubmitButton>
          </form>
        }
      />
      <div className="grid main-side">
        <div className="stack">
          <h2 className="display" style={{ fontSize: 20 }}>WhatsApp</h2>
          {whatsapp.map((t) => (
            <TemplateCard key={t.id} template={t} />
          ))}
          <h2 className="display" style={{ fontSize: 20, marginTop: 10 }}>Email</h2>
          {email.map((t) => (
            <TemplateCard key={t.id} template={t} />
          ))}
        </div>
        <aside>
          <Card title="Placeholders" className="anim-in">
            <div className="list" style={{ position: "sticky", top: 20 }}>
              {PLACEHOLDERS.map((p) => (
                <div key={p.key} className="list-item" style={{ padding: "8px 16px", display: "block" }}>
                  <code style={{ fontWeight: 600, color: "var(--court-2)" }}>{`{{${p.key}}}`}</code>
                  <div className="small muted">{p.description}</div>
                </div>
              ))}
            </div>
          </Card>
        </aside>
      </div>
    </>
  );
}
