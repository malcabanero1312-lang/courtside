"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import { friendlyError } from "@/lib/errors";
import { normalizePhone } from "@/lib/whatsapp";
import { parseCsv } from "@/lib/csv";

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function back(path: string, kind: "notice" | "error", message: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(message)}`);
}

const EMAIL = /^[^@\s,()]+@[^@\s,()]+\.[^@\s,()]+$/;

function readStudent(formData: FormData, countryCode: string) {
  const rawPhone = text(formData, "phone");
  const phone = normalizePhone(rawPhone, countryCode);
  const email = text(formData, "email").toLowerCase() || null;
  return {
    values: {
      full_name: text(formData, "full_name"),
      phone,
      email,
      guardian_name: text(formData, "guardian_name") || null,
      level: text(formData, "level") || null,
      notes: text(formData, "notes") || null,
      preferred_channel: text(formData, "preferred_channel") === "email" ? "email" : "whatsapp",
      email_opt_in: formData.get("email_opt_in") === "on",
      is_regular: formData.get("is_regular") === "on"
    },
    error: !text(formData, "full_name")
      ? "Enter the student's name."
      : rawPhone && !phone
        ? "That phone number doesn't look right. Include the area code."
        : email && !EMAIL.test(email)
          ? "That email address doesn't look right."
          : !phone && !email
            ? "Add a WhatsApp number or an email."
            : null
  };
}

export async function createStudent(formData: FormData) {
  const { supabase, org, user } = await requireSession(["admin", "agent"]);
  const { values, error } = readStudent(formData, org.default_country_code);
  if (error) back("/students", "error", error);
  const { data, error: dbError } = await supabase
    .from("students")
    .insert({ ...values, org_id: org.id, created_by: user.id })
    .select("id")
    .single();
  if (dbError || !data) back("/students", "error", friendlyError(dbError));
  revalidatePath("/students");
  back(`/students/${data.id}`, "notice", "Student added.");
}

export async function updateStudent(formData: FormData) {
  const { supabase, org } = await requireSession(["admin", "agent"]);
  const id = text(formData, "id");
  const { values, error } = readStudent(formData, org.default_country_code);
  if (error) back(`/students/${id}`, "error", error);
  const { error: dbError } = await supabase.from("students").update(values).eq("id", id);
  if (dbError) back(`/students/${id}`, "error", friendlyError(dbError));
  revalidatePath(`/students/${id}`);
  back(`/students/${id}`, "notice", "Student updated.");
}

export async function setStudentArchived(formData: FormData) {
  const { supabase } = await requireSession(["admin", "agent"]);
  const id = text(formData, "id");
  const archived = text(formData, "archived") === "1";
  const { error } = await supabase.from("students").update({ is_archived: archived }).eq("id", id);
  if (error) back(`/students/${id}`, "error", friendlyError(error));
  revalidatePath("/students");
  back(`/students/${id}`, "notice", archived ? "Student archived. Their history is kept." : "Student restored.");
}

export async function importStudents(formData: FormData) {
  const { supabase, org, user } = await requireSession(["admin", "agent"]);
  const file = formData.get("file");
  let content = text(formData, "csv");
  if (file && typeof file === "object" && "text" in file && (file as File).size > 0) {
    if ((file as File).size > 2_000_000) back("/students", "error", "That file is too large. Split it into files under 2 MB.");
    content = await (file as File).text();
  }
  if (!content) back("/students", "error", "Choose a CSV file or paste rows to import.");

  const rows = parseCsv(content);
  if (rows.length === 0) back("/students", "error", "We couldn't find any rows in that file.");

  const header = rows[0].map((h) => h.toLowerCase());
  const find = (...names: string[]) => header.findIndex((h) => names.some((n) => h.includes(n)));
  let nameIdx = find("name", "student");
  let phoneIdx = find("phone", "mobile", "whatsapp", "number");
  let emailIdx = find("email", "e-mail");
  const guardianIdx = find("guardian", "parent");
  const notesIdx = find("note", "comment");
  let dataRows = rows.slice(1);
  if (nameIdx === -1) {
    nameIdx = 0;
    phoneIdx = 1;
    emailIdx = 2;
    dataRows = rows;
  }

  const { data: existing } = await supabase.from("students").select("phone, email").eq("org_id", org.id).limit(20000);
  const phones = new Set((existing ?? []).map((s: { phone: string | null }) => s.phone).filter(Boolean));
  const emails = new Set((existing ?? []).map((s: { email: string | null }) => s.email?.toLowerCase()).filter(Boolean));

  const toInsert: Record<string, unknown>[] = [];
  let duplicates = 0;
  let invalid = 0;
  for (const row of dataRows.slice(0, 5000)) {
    const fullName = (row[nameIdx] ?? "").trim();
    const phone = phoneIdx >= 0 ? normalizePhone(row[phoneIdx], org.default_country_code) : null;
    const rawEmail = emailIdx >= 0 ? (row[emailIdx] ?? "").trim().toLowerCase() : "";
    const email = rawEmail && EMAIL.test(rawEmail) ? rawEmail : null;
    if (!fullName || (!phone && !email)) {
      invalid += 1;
      continue;
    }
    if ((phone && phones.has(phone)) || (email && emails.has(email))) {
      duplicates += 1;
      continue;
    }
    if (phone) phones.add(phone);
    if (email) emails.add(email);
    toInsert.push({
      org_id: org.id,
      full_name: fullName.slice(0, 120),
      phone,
      email,
      guardian_name: guardianIdx >= 0 ? row[guardianIdx] || null : null,
      notes: notesIdx >= 0 ? row[notesIdx] || null : null,
      preferred_channel: phone ? "whatsapp" : "email",
      created_by: user.id
    });
  }

  let imported = 0;
  for (let i = 0; i < toInsert.length; i += 500) {
    const chunk = toInsert.slice(i, i + 500);
    const { error } = await supabase.from("students").insert(chunk);
    if (error) {
      back(
        "/students",
        "error",
        `Imported ${imported} students, then stopped: ${friendlyError(error)} Nothing after row ${i + 1} was imported.`
      );
    }
    imported += chunk.length;
  }
  revalidatePath("/students");
  back(
    "/students",
    "notice",
    `Imported ${imported} student${imported === 1 ? "" : "s"}.` +
      (duplicates ? ` Skipped ${duplicates} already in your list.` : "") +
      (invalid ? ` Skipped ${invalid} rows without a name and a valid phone or email.` : "")
  );
}
