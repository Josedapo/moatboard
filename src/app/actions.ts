"use server";

import { sql } from "@/lib/db";

export type WaitlistState = {
  ok?: true;
  error?: string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function submitWaitlistEmailAction(
  _prev: WaitlistState,
  formData: FormData,
): Promise<WaitlistState> {
  const raw = (formData.get("email") ?? "").toString().trim().toLowerCase();
  if (!raw) {
    return { error: "Please enter an email address." };
  }
  if (raw.length > 320 || !EMAIL_RE.test(raw)) {
    return { error: "That doesn't look like a valid email." };
  }
  try {
    // ON CONFLICT: swallow duplicates silently. Two submissions from the
    // same address shouldn't surface an error to the visitor.
    await sql`
      INSERT INTO waitlist_emails (email, source)
      VALUES (${raw}, 'homepage')
      ON CONFLICT (LOWER(email)) DO NOTHING
    `;
    return { ok: true };
  } catch (err) {
    console.error("waitlist insert failed:", err);
    return { error: "Couldn't save it just now. Please try again." };
  }
}
