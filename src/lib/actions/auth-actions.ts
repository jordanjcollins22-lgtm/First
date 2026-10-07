"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cleanCode, looksLikeEmail } from "@/lib/client-portal";
import { deliverLoginCode } from "@/lib/login-code";
import { safeReturnTo } from "@/lib/return-to";

export type CodeResult = { ok: true; message: string } | { ok: false; error: string };

export async function login(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) {
    throw new Error("Enter your email and password.");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    throw new Error("Incorrect email or password.");
  }

  revalidatePath("/", "layout");
  // Back to the page they were sent to, when there was one.
  redirect(safeReturnTo(String(formData.get("next") ?? "")));
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}

/**
 * Email a sign-in code to a team member.
 *
 * The answer is the same whether or not the address has an account, so the
 * sign-in box cannot be used to find out who works here. No account is
 * ever created from this box: accounts are made under Team.
 */
export async function sendLoginCode(email: string): Promise<CodeResult> {
  const address = email.trim().toLowerCase();
  if (!looksLikeEmail(address)) return { ok: false, error: "That doesn't look like an email address." };

  const delivered = await deliverLoginCode(address, "JS Landscaping");
  if (!delivered.ok) return { ok: false, error: delivered.error };

  return { ok: true, message: `If ${address} has an account, a six-digit code is on its way. It lasts about an hour.` };
}

/** Takes the code and signs them in. A client who comes in here is sent to their own screen. */
export async function verifyLoginCode(email: string, code: string): Promise<CodeResult> {
  const address = email.trim().toLowerCase();
  const token = cleanCode(code);
  if (token.length !== 6) return { ok: false, error: "That code should be six digits." };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({ email: address, token, type: "email" });
  if (error || !data.user) return { ok: false, error: "That code didn't work. Ask for a new one and try again." };

  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("id").eq("id", data.user.id).maybeSingle();
  revalidatePath("/", "layout");
  return { ok: true, message: profile ? "staff" : "client" };
}
