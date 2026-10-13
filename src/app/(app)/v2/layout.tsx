import { PreviewAs } from "@/components/v2/preview-as";
import { V2PagesNav } from "@/components/v2/v2-pages-nav";
import { getCurrentProfile, getRealProfile, listProfiles } from "@/lib/data/team";
import { isSupabaseConfigured } from "@/lib/env";
import { isOwnerLevel } from "@/lib/roles";
import { v2PagesFor, v2RolesOf } from "@/lib/v2-roles";

/**
 * The four-page bar, shared by every page of the new layout so it never waits
 * on a page's data. Only the pages the previewed person has are on it, and
 * the owner picks who that is here.
 */
export default async function V2Layout({ children }: { children: React.ReactNode }) {
  let pages: ("marketing" | "sales" | "operations" | "admin")[] = ["marketing", "sales", "operations", "admin"];
  let picker: React.ReactNode = null;
  if (isSupabaseConfigured) {
    const [me, viewer] = await Promise.all([getRealProfile(), getCurrentProfile()]);
    if (me && viewer) pages = v2PagesFor(v2RolesOf(viewer));
    if (me && isOwnerLevel(me.roles) && me.roles.includes("admin")) {
      const team = await listProfiles().catch(() => []);
      picker = (
        <PreviewAs
          meId={me.id}
          currentId={viewer?.id ?? me.id}
          people={team.map((p) => ({ id: p.id, name: p.full_name || p.email, roles: [...p.roles, ...(p.is_affiliate ? ["affiliate"] : [])].join(", ") }))}
        />
      );
    }
  }
  return (
    <div className="mx-auto w-full max-w-7xl px-4 pt-5">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <V2PagesNav pages={pages} />
        </div>
        {picker}
      </div>
      {children}
    </div>
  );
}
