import { isSupabaseConfigured } from "@/lib/env";
import { requireTab } from "@/lib/data/access";
import { getCurrentProfile } from "@/lib/data/team";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { PageTabs } from "@/components/ui/page-tabs";
import { ContactImportPanel } from "@/components/contacts/contact-import-panel";
import { ContactsManager } from "@/components/contacts/contacts-manager";
import { getContacts, type ContactsData } from "@/lib/data/contacts";
import { bookLine, summariseBook } from "@/lib/client-status";

/**
 * The contact book, at the address called contacts.
 *
 * It was not here. This page was the importer alone and the book itself was a
 * tab on Project Data, which was survivable while Project Data was in the nav
 * and nobody clicked "Contacts" expecting contacts. Once Contacts became a
 * headline entry, clicking it opened an upload form and an empty screen —
 * three thousand records in the database and none of them on the page named
 * after them.
 *
 * So the book is here and importing is a tab beside it. Still a tab rather
 * than the front of the page: the screen somebody opens to look one person up
 * should not also be the screen that can overwrite three thousand records.
 */
export default async function ContactsPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  await requireTab("contacts", "/my-day");

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:py-8">
      <h1 className="mb-1 text-2xl font-bold">Contacts</h1>
      <p className="mb-4 text-sm text-muted-foreground sm:mb-6 sm:text-base">
        Everyone in the book. Search by name, email, phone or address.
      </p>
      <PageTabs
        tabs={[
          { key: "book", label: "The book", content: await BookTab() },
          { key: "import", label: "Import", content: <ImportTab /> },
        ]}
      />
    </div>
  );
}

async function BookTab() {
  const profile = await getCurrentProfile();
  // Merging is irreversible, so it stays with admins even where the page
  // itself is open to more people.
  const canMerge = Boolean(profile?.roles.includes("admin"));

  let data: ContactsData = {
    contacts: [],
    duplicates: [],
    pendingGeocodes: 0,
    failedGeocodes: 0,
    recentMerges: [],
    outOfArea: [],
  };
  try {
    data = await getContacts();
  } catch (err) {
    console.error("Contacts failed to load:", err);
  }

  return (
    <div>
      {/* Said out loud because the word changed meaning: a client is somebody
          who has paid, and the label on every row is worked out from the
          money rather than from whatever an import wrote on it. */}
      <p className="mb-4 text-sm text-muted-foreground">
        {bookLine(summariseBook(data.contacts))}
      </p>
      <ContactsManager data={data} canMerge={canMerge} />
    </div>
  );
}

function ImportTab() {
  return (
    <div>
      <p className="mb-4 text-sm text-muted-foreground">
        Upload a CSV from your CRM or a spreadsheet. Contacts already here are matched and updated
        rather than added twice.
      </p>
      <ContactImportPanel />
    </div>
  );
}
