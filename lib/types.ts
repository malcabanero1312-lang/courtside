export type Role = "admin" | "agent" | "coach";

export type AppointmentStatus =
  | "scheduled"
  | "awaiting_response"
  | "pending_approval"
  | "confirmed"
  | "not_approved"
  | "reschedule_requested"
  | "declined"
  | "cancelled"
  | "rescheduled"
  | "completed"
  | "no_show";

export interface Organization {
  id: string;
  name: string;
  timezone: string;
  default_country_code: string;
  default_duration_minutes: number;
  slot_step_minutes: number;
  reminder_hours_before: number;
  response_link_days: number;
  follow_up_after_hours: number;
  brand_color: string;
  reply_to_email: string | null;
  notify_student_email: boolean;
  notify_coach_email: boolean;
  notify_agent_email: boolean;
  cancellation_policy: string | null;
  office_name: string | null;
  office_phone: string | null;
  contact_phone: string | null;
  confirm_days_before: number;
}

export interface Membership {
  id: string;
  org_id: string;
  user_id: string;
  role: Role;
  full_name: string;
  email: string;
  phone: string | null;
}

export interface Student {
  id: string;
  org_id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  preferred_channel: "whatsapp" | "email";
  email_opt_in: boolean;
  level: string | null;
  guardian_name: string | null;
  notes: string | null;
  is_archived: boolean;
  is_regular?: boolean;
  created_at: string;
}

export interface Coach {
  id: string;
  org_id: string;
  user_id: string | null;
  full_name: string;
  email: string | null;
  phone: string | null;
  color: string;
  specialties: string | null;
  is_active: boolean;
}

export interface Venue {
  id: string;
  org_id: string;
  name: string;
  address: string | null;
  maps_url: string | null;
  opens_at: string;
  closes_at: string;
  notes: string | null;
  is_active: boolean;
}

export interface Court {
  id: string;
  org_id: string;
  venue_id: string;
  name: string;
  alt_name?: string | null;
  surface: string | null;
  is_active: boolean;
}

export interface SessionType {
  id: string;
  org_id: string;
  name: string;
  duration_minutes: number;
  is_active: boolean;
}

export interface Appointment {
  id: string;
  org_id: string;
  reference: string;
  student_id: string;
  coach_id: string;
  venue_id: string;
  court_id: string | null;
  session_type_id: string | null;
  starts_at: string;
  ends_at: string;
  status: AppointmentStatus;
  assigned_agent_id: string | null;
  notes: string | null;
  student_note: string | null;
  cancellation_reason: string | null;
  rescheduled_from_id: string | null;
  contacted_at: string | null;
  responded_at: string | null;
  reminder_queued_at: string | null;
  office_contacted_at: string | null;
  student_informed_at: string | null;
  office_note: string | null;
  office_approved: boolean;
  message_due_at: string | null;
  import_batch: string | null;
  share_group?: string | null;
  created_at: string;
  updated_at: string;
  version: number;
}

export interface AppointmentWithRelations extends Appointment {
  student: Pick<Student, "id" | "full_name" | "phone" | "email" | "email_opt_in" | "guardian_name"> | null;
  coach: Pick<Coach, "id" | "full_name" | "color" | "email" | "user_id"> | null;
  venue: Pick<Venue, "id" | "name" | "address" | "maps_url"> | null;
  court: Pick<Court, "id" | "name"> | null;
  session_type: Pick<SessionType, "id" | "name"> | null;
  agent: Pick<Membership, "id" | "full_name" | "email"> | null;
}

export interface SlotIssue {
  code: string;
  severity: "block" | "warn";
  message: string;
}

export interface SlotSuggestion {
  starts_at: string;
  ends_at: string;
  court_id: string | null;
  date: string;
  time: string;
  label: string;
}

export interface MessageTemplate {
  id: string;
  org_id: string;
  key: string;
  channel: "whatsapp" | "email";
  name: string;
  subject: string | null;
  body: string;
}

export const APPOINTMENT_SELECT =
  "*, student:students(id, full_name, phone, email, email_opt_in, guardian_name), coach:coaches(id, full_name, color, email, user_id), venue:venues(id, name, address, maps_url), court:courts(id, name), session_type:session_types(id, name), agent:memberships(id, full_name, email)";
