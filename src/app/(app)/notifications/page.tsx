import { isSupabaseConfigured, isTwilioConfigured } from "@/lib/env";
import { getMyNotificationSettings } from "@/lib/data/notification-preferences";
import { NotificationSettings } from "@/components/notifications/notification-settings";

// Open to anyone signed in — notification settings are personal, not
// something an admin manages on someone else's behalf.
export default async function NotificationsPage() {
  if (!isSupabaseConfigured) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-6 sm:py-10">
        <p className="text-muted-foreground">Supabase is not configured yet.</p>
      </div>
    );
  }

  let settings: Awaited<ReturnType<typeof getMyNotificationSettings>> = null;
  let migrationMissing = false;
  try {
    settings = await getMyNotificationSettings();
  } catch {
    migrationMissing = true;
  }

  if (migrationMissing) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-6 sm:py-8">
        <h1 className="mb-1 text-2xl font-bold">Notifications</h1>
        <p className="rounded-lg border border-white/60 bg-card/60 px-3 py-3 text-sm text-muted-foreground backdrop-blur-md">
          This page needs its database migration run first. In Supabase&apos;s SQL Editor, run{" "}
          <code>supabase/migrations/0067_notification_preferences.sql</code>, then reload this page.
        </p>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-6 sm:py-10">
        <p className="text-muted-foreground">Sign in to manage your notifications.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:py-8">
      <h1 className="mb-1 text-2xl font-bold">Notifications</h1>
      <p className="mb-6 text-muted-foreground">
        Choose what you want texted to you. These are your settings — nobody else&apos;s.
      </p>
      <NotificationSettings
        preferences={settings.preferences}
        phone={settings.phone}
        smsConfigured={isTwilioConfigured}
        channels={settings.channels}
      />
    </div>
  );
}
