import { PreviewAs } from "@/components/v2/preview-as";
import { V2PagesNav } from "@/components/v2/v2-pages-nav";
import { getCurrentProfile, getRealProfile, listProfiles } from "@/lib/data/team";
import { isSupabaseConfigured } from "@/lib/env";
import { isOwnerLevel } from "@/lib/roles";
import { v2PagesFor, v2RolesOf } from "@/lib/v2-roles";
import { TutorialRunner } from "@/components/tutorial/tutorial-runner";
import { toursFor } from "@/lib/tutorials";
import type { Tour } from "@/lib/tutorials/types";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The four-page bar, shared by every page of the new layout so it never waits
 * on a page's data. Only the pages the previewed person has are on it, and
 * the owner picks who that is here.
 */
export default async function V2Layout({ children }: { children: React.ReactNode }) {
  let pages: ("marketing" | "sales" | "operations" | "admin")[] = ["marketing", "sales", "operations", "admin"];
  let picker: React.ReactNode = null;
  let tours: Tour[] = [];
  let autoStart = false;
  if (isSupabaseConfigured) {
    const [me, viewer] = await Promise.all([getRealProfile(), getCurrentProfile()]);
    if (me && viewer) {
      const roles = v2RolesOf(viewer);
      pages = v2PagesFor(roles);
      // The tutorial for the person being shown. It opens by itself the first
      // time somebody opens the app as themselves; while the owner previews
      // somebody else it waits for the Help button.
      tours = toursFor(roles);
      if (tours.length && viewer.id === me.id) {
        const sb = (await createClient()) as unknown as SupabaseClient;
        const { data } = await sb.from("tutorial_progress").select("tour").eq("profile_id", me.id);
        const done = new Set((data ?? []).map((r: { tour: string }) => r.tour));
        autoStart = tours.some((t) => !done.has(t.id));
      }
    }
    if (me && isOwnerLevel(me.roles) && me.roles.includes("admin")) {
      // Only this business's people: a superadmin can read other businesses' too.
      const team = (await listProfiles().catch(() => [])).filter((p) => p.organization_id === me.organization_id);
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
      <TutorialRunner tours={tours} autoStart={autoStart} />
    </div>
  );
}
