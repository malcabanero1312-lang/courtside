import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/session";
import { Card, Flash, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/buttons";
import { updateMyProfile } from "../team/actions";

export const metadata: Metadata = { title: "My account" };

export default async function AccountPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const { membership, org, user } = await requireSession();
  return (
    <>
      <Flash params={params} />
      <PageHeader title="My account" subtitle={`${user.email} · ${membership.role} at ${org.name}`} />
      <div className="grid two">
        <Card title="Your name" padded>
          <form action={updateMyProfile} className="stack">
            <input type="hidden" name="return_to" value="/account" />
            <label className="field">
              <span>Name</span>
              <input className="input" name="full_name" defaultValue={membership.full_name} />
              <small>Used in WhatsApp messages you send, e.g. “This is Ana from …”.</small>
            </label>
            <SubmitButton variant="primary" size="small">Save</SubmitButton>
          </form>
        </Card>
        <Card title="Password" padded>
          <div className="stack">
            <p className="small muted">Choose a new password for signing in.</p>
            <Link className="btn" href="/reset-password">
              Change password
            </Link>
          </div>
        </Card>
      </div>
    </>
  );
}
