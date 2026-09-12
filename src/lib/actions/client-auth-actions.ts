"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { looksLikeEmail, cleanCode, sentMessage } from "@/lib/client-portal";

export type AuthResult = { ok: true; message: string } | { ok: false; error: string };

/**
 * Send a client a code.
 *
 * Never says whether the address is one of ours. Somebody typing addresses in
 * to find out who we work for should learn nothing, so the answer is the same
 * either way and the code simply does not arrive when there is nobody to send
 * it to.
 *
 * `shouldCreateUser` is off. Accounts are made when somebody books, from an
 * address they gave us in a form we watched them fill in — not by anybody who
 * can reach this box. Leaving it on would let a stranger create an account on
 * any address they liked.
 */
export async function sendClientCode(email: string): Promise<AuthResult> {
  const address = email.trim().toLowerCase();
  if (!looksLikeEmail(address)) return { ok: false, error: "That doesn't look like an email address." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: address,
    options: { shouldCreateUser: false },
  });

  // Logged, not shown. A failure here is usually "no such user", which is
  // exactly the thing this must not disclose.
  if (error) console.warn(`client code not sent to ${address}: ${error.message}`);

  return { ok: true, message: sentMessage(address) };
}

/**
 * Take the code and sign them in.
 *
 * A wrong code says so plainly, because at this point they have already told
 * us the address and there is nothing left to protect by being vague — and a
 * vague error on the last step of a sign-in is maddening.
 */
export async function verifyClientCode(email: string, code: string): Promise<AuthResult> {
  const address = email.trim().toLowerCase();
  const token = cleanCode(code);
  if (token.length !== 6) return { ok: false, error: "That code should be six digits." };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({ email: address, token, type: "email" });
  if (error || !data.user) {
    return { ok: false, error: "That code didn't work. Ask for a new one and try again." };
  }

  // A member of staff who signs in here is sent to the app instead. Their
  // account is not a client account and this is not their screen.
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("id").eq("id", data.user.id).maybeSingle();
  if (profile) return { ok: true, message: "staff" };

  return { ok: true, message: "in" };
}

/** End the session from the client side of the app. */
export async function signClientOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
}
