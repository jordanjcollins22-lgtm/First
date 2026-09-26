import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { outboundReady, sendOutbound } from "@/lib/email/outbound";
import { log, maskEmail } from "@/lib/log";

/**
 * Getting a sign-in code to somebody.
 *
 * Supabase can mail the code itself, and did, but its built-in mailer sends
 * two emails an hour for the whole project, lands in spam, and puts whatever
 * the dashboard's template says in the message. So when the business's own
 * mail is ready, the code is minted here and sent as a plain six-digit
 * number from the business's own address. Supabase's mailer is the fallback
 * for the day the business's mail is not ready.
 *
 * The answer to the caller is the same whether or not the address has an
 * account: nothing here says who works here or who is a client. The one
 * thing said out loud is a rate limit, because "the code is on its way"
 * when it is not is what wastes somebody's afternoon.
 */
export type CodeDelivery = { ok: true } | { ok: false; error: string };

const MINUTE = /rate limit|too many|after \d+ seconds/i;

export async function deliverLoginCode(address: string, businessName: string): Promise<CodeDelivery> {
  const admin = createAdminClient();

  // Whose mail to send from: the team member's business, or the client's.
  const [{ data: profile }, { data: customer }] = await Promise.all([
    admin.from("profiles").select("organization_id").eq("email", address).maybeSingle(),
    admin.from("customers").select("organization_id").eq("email", address).not("auth_user_id", "is", null).limit(1).maybeSingle(),
  ]);
  const organizationId = profile?.organization_id ?? customer?.organization_id ?? null;

  if (organizationId) {
    const ready = await outboundReady(organizationId).catch(() => ({ ready: false, why: "probe failed" }));
    if (ready.ready) {
      const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: address });
      const code = data?.properties?.email_otp;
      if (!error && code) {
        const sent = await sendOutbound({
          organizationId,
          to: address,
          subject: `${code} is your ${businessName} sign-in code`,
          text: [`Your sign-in code is ${code}.`, "", "Type it on the sign-in screen. It works for about an hour and only once.", "", `If you did not ask for this, ignore it. Nobody can sign in without the code.`].join("\n"),
          fromName: businessName,
        });
        if (sent.ok) {
          log.info("login.code.sent", { to: maskEmail(address), via: sent.via });
          return { ok: true };
        }
        log.warn("login.code.own_mail_failed", { to: maskEmail(address), error: sent.message });
        // Fall through: Supabase's mailer gets a turn.
      } else if (error && !/not found|does not exist/i.test(error.message)) {
        log.warn("login.code.generate_failed", { to: maskEmail(address), error: error.message });
      }
    }
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({ email: address, options: { shouldCreateUser: false } });
  if (error) {
    log.warn("login.code.not_sent", { to: maskEmail(address), error: error.message });
    if (MINUTE.test(error.message)) {
      return { ok: false, error: "Too many codes were asked for just now. Wait a minute and try once more." };
    }
  }
  return { ok: true };
}
