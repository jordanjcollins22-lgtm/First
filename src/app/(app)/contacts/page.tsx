import { isSupabaseConfigured } from "@/lib/env";
import { requireTab } from "@/lib/data/access";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { ContactImportPanel } from "@/components/contacts/contact-import-panel";

/**
 * Bringing a list of contacts in.
 *
 * Contacts used to be in two places at once: a tab on Pipeline and a redirect
 * here, with the importer buried inside the list. Nobody could say where "the
 * contacts" lived. The book itself is one tab on Project Data now, and this
 * address does the one thing it is named for.
 */
export default async function ContactsImportPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  await requireTab("contacts", "/attractors");

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:py-8">
      <h1 className="mb-1 text-2xl font-bold">Import list of contacts</h1>
      <p className="mb-6 text-muted-foreground">
        Upload a CSV from your CRM or a spreadsheet. The whole book lives under Project Data, on the
        Contacts tab.
      </p>

      <ContactImportPanel />
    </div>
  );
}
