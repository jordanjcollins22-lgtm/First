import { isSupabaseConfigured } from "@/lib/env";
import { requireTab } from "@/lib/data/access";
import { getCurrentProfile } from "@/lib/data/team";
import { getContacts, type ContactsData } from "@/lib/data/contacts";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { ContactsManager } from "@/components/contacts/contacts-manager";

export default async function ContactsPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  await requireTab("contacts", "/attractors");

  const profile = await getCurrentProfile();
  // Merging is irreversible, so it stays with admins even where the page
  // itself is open to more people.
  const canMerge = Boolean(profile?.roles.includes("admin"));

  let data: ContactsData = { contacts: [], duplicates: [] };
  try {
    data = await getContacts();
  } catch (err) {
    console.error("Contacts failed to load:", err);
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:py-8">
      <h1 className="mb-1 text-2xl font-bold">Contacts</h1>
      <p className="mb-6 text-muted-foreground">
        Everyone in the book, and any records that look like the same person entered twice.
      </p>
      <ContactsManager data={data} canMerge={canMerge} />
    </div>
  );
}
