import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Giving a client an account, quietly, at the moment they book.
 *
 * No password is ever set. There is nothing to choose, nothing to forget and
 * nothing to reuse from somewhere else — they come back by asking for a code.
 *
 * Deliberately carries no organization in its metadata. That is what the
 * signup trigger reads to decide whether somebody is staff, so an account made
 * here gets an identity and no profile, no role, and no page in the app.
 *
 * Best-effort throughout. A booking that succeeded must never be undone
 * because the auth server was slow, so every failure here is logged and
 * swallowed and the client simply has no account until the next time.
 */
export async function ensureClientAccount(input: {
  customerId: string;
  email: string;
}): Promise<void> {
  const email = input.email.trim().toLowerCase();
  if (!email) return;

  try {
    const admin = createAdminClient();

    const { data: customer } = await admin
      .from("customers")
      .select("id, auth_user_id")
      .eq("id", input.customerId)
      .maybeSingle();
    if (!customer || customer.auth_user_id) return;

    const existing = await findUserByEmail(email);
    let userId = existing;

    if (!userId) {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        // Confirmed because they typed it into a form we watched them fill in,
        // and because an unconfirmed account cannot be sent a code. Nothing is
        // granted by it: signing in still needs the code, and the code goes to
        // this address.
        email_confirm: true,
        user_metadata: { account_type: "client" },
      });
      if (error) {
        console.warn(`client account not created for ${email}: ${error.message}`);
        return;
      }
      userId = data.user?.id ?? null;
    }

    if (!userId) return;

    await admin
      .from("customers")
      .update({ auth_user_id: userId })
      .eq("id", input.customerId)
      // Only if nobody won the race, so two bookings a second apart cannot
      // fight over the same row.
      .is("auth_user_id", null);
  } catch (err) {
    console.warn("client account step failed:", err);
  }
}

/**
 * The auth user for an address, if there is one.
 *
 * Paged rather than filtered: the admin listing has no email filter, and a
 * business with a few thousand clients is a handful of pages. Stops at the
 * first match.
 */
async function findUserByEmail(email: string): Promise<string | null> {
  const admin = createAdminClient();
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data?.users?.length) return null;
    const found = data.users.find((user) => (user.email ?? "").toLowerCase() === email);
    if (found) return found.id;
    if (data.users.length < 200) return null;
  }
  return null;
}
