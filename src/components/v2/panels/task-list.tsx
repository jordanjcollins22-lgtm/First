import { createClient } from "@/lib/supabase/server";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { listOwnerTasks } from "@/lib/data/owner-tasks";
import { countTasks } from "@/lib/owner-tasks";
import { TaskListEditor } from "@/components/v2/panels/task-list-editor";

/**
 * Admin › Task list: the owner's list, shared and saved.
 *
 * Replaces the v2 Task list that lived in one browser's localStorage. Same
 * 33 items to start (seeded by migration 0356b), plus anything the owner or
 * an account manager adds. Every tick and status change is recorded with
 * who made it.
 */
export async function TaskListPanel() {
  const supabase = await createClient();
  const organizationId = await getCurrentOrganizationId();
  const tasks = await listOwnerTasks(supabase, organizationId);
  const counts = countTasks(tasks);

  return (
    <section className="grid gap-4 rounded-2xl border bg-card p-4 sm:p-5">
      <header>
        <h2 className="text-lg font-extrabold">Task list</h2>
        <p className="text-sm text-muted-foreground">Shared with everyone who runs the business. Ticks are saved for everybody, with who did them.</p>
      </header>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Stat label="Not built" value={counts.notBuilt} cls="bg-orange-100 text-orange-900 dark:bg-orange-900/40 dark:text-orange-100" />
        <Stat label="Partly built" value={counts.partlyBuilt} cls="bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100" />
        <Stat label="Still open" value={counts.open} cls="bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-100" />
        <Stat label="Done" value={counts.done} cls="bg-muted" />
      </div>

      {tasks.length === 0 ? (
        <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
          No tasks yet. Anything added below is saved straight away.
        </p>
      ) : null}
      {/* Keyed on what the tasks say, so a change made in the drawer shows here too. */}
      <TaskListEditor key={tasks.map((t) => `${t.id}:${t.status}:${t.title}:${t.note ?? ""}`).join("|")} tasks={tasks} />
    </section>
  );
}

function Stat({ label, value, cls }: { label: string; value: number; cls: string }) {
  return (
    <div className={"rounded-lg p-3 " + cls}>
      <div className="text-xs">{label}</div>
      <div className="font-mono text-2xl">{value}</div>
    </div>
  );
}
