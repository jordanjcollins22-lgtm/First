"use client";

import { useState, useTransition } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { pauseGroupAgent, resumeGroupAgent, updateAgentSettings } from "@/lib/actions/outreach-agent-actions";
import type { AgentGroup, AgentSettings, AgentSources } from "@/lib/outreach-agent";

/**
 * The owner's controls for the group agent.
 *
 * Groups by link, the words a post has to contain, how many comments an
 * hour and a day, the hours it may post in, and whether it posts at all or
 * only writes. Saved as one thing, because they only make sense together.
 */
export function AgentSettingsForm({ settings, owner, paused }: { settings: AgentSettings; owner: boolean; paused: boolean }) {
  const [groups, setGroups] = useState<AgentGroup[]>(settings.groups.length > 0 ? settings.groups : [{ url: "", name: "" }]);
  const [sources, setSources] = useState<AgentSources>(settings.sources);
  const [searchPhrases, setSearchPhrases] = useState(settings.searchPhrases.join("\n"));
  const [areaWords, setAreaWords] = useState(settings.areaWords.join(", "));
  const [keywords, setKeywords] = useState(settings.keywords.join(", "));
  const [dailyCap, setDailyCap] = useState(String(settings.dailyCap));
  const [hourlyCap, setHourlyCap] = useState(String(settings.hourlyCap));
  const [activeFrom, setActiveFrom] = useState(settings.activeFrom);
  const [activeTo, setActiveTo] = useState(settings.activeTo);
  const [scanEvery, setScanEvery] = useState(String(settings.scanEveryMinutes));
  const [maxAge, setMaxAge] = useState(String(settings.maxAgeDays));
  const [autoPost, setAutoPost] = useState(settings.autoPost);
  const [pickPosts, setPickPosts] = useState(settings.pickPosts);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setMessage(null);
    startTransition(async () => {
      const result = await updateAgentSettings({
        groups: groups.filter((g) => g.url.trim()),
        sources,
        searchPhrases,
        areaWords,
        keywords,
        dailyCap: Number(dailyCap),
        hourlyCap: Number(hourlyCap),
        activeFrom,
        activeTo,
        scanEveryMinutes: Number(scanEvery),
        maxAgeDays: Number(maxAge),
        autoPost,
        pickPosts,
      });
      setMessage(result.ok ? "Saved. The browser picks it up within a minute." : result.error);
    });
  }

  function pause(hours: number | null) {
    setMessage(null);
    startTransition(async () => {
      const result = await pauseGroupAgent({ hours, reason: "Paused by hand." });
      setMessage(result.ok ? "Paused." : result.error);
    });
  }

  function resume() {
    setMessage(null);
    startTransition(async () => {
      const result = await resumeGroupAgent();
      setMessage(result.ok ? "Running again." : result.error);
    });
  }

  const disabled = !owner || pending;

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Where it looks</p>
        <SourceRow
          checked={sources.feed}
          disabled={disabled}
          onChange={(v) => setSources((s) => ({ ...s, feed: v }))}
          label="Your groups feed"
          blurb="Every group you're a member of, on one page. Covers any group you join from now on with nothing to type here."
        />
        <SourceRow
          checked={sources.search}
          disabled={disabled}
          onChange={(v) => setSources((s) => ({ ...s, search: v }))}
          label="Facebook post search"
          blurb="Searches the phrases below. Reaches public groups you're not in yet; those go on the groups-to-join list."
        />
        <SourceRow
          checked={sources.list}
          disabled={disabled}
          onChange={(v) => setSources((s) => ({ ...s, list: v }))}
          label="The groups listed below"
          blurb="For any group that deserves a look of its own."
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground" htmlFor="agent-phrases">
            Search phrases, one per line
          </label>
          <Textarea id="agent-phrases" value={searchPhrases} disabled={disabled || !sources.search} rows={5} onChange={(e) => setSearchPhrases(e.target.value)} />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground" htmlFor="agent-area">
            A searched post has to mention one of these
          </label>
          <Textarea id="agent-area" value={areaWords} disabled={disabled || !sources.search} rows={5} onChange={(e) => setAreaWords(e.target.value)} />
          <p className="text-xs text-muted-foreground">Towns and zip codes. Without this, search answers people in other states.</p>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Groups to watch on their own</p>
        {groups.map((group, index) => (
          <div key={index} className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={group.url}
              disabled={disabled}
              placeholder="https://www.facebook.com/groups/…"
              onChange={(e) => setGroups((all) => all.map((g, i) => (i === index ? { ...g, url: e.target.value } : g)))}
              className="sm:flex-[2]"
            />
            <Input
              value={group.name}
              disabled={disabled}
              placeholder="What the group is called"
              onChange={(e) => setGroups((all) => all.map((g, i) => (i === index ? { ...g, name: e.target.value } : g)))}
              className="sm:flex-1"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={disabled}
              aria-label="Remove this group"
              onClick={() => setGroups((all) => (all.length === 1 ? [{ url: "", name: "" }] : all.filter((_, i) => i !== index)))}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => setGroups((all) => [...all, { url: "", name: "" }])}>
          <Plus className="mr-1 h-4 w-4" /> Another group
        </Button>
      </div>

      <div className="space-y-1">
        <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground" htmlFor="agent-keywords">
          A post has to mention one of these
        </label>
        <Textarea id="agent-keywords" value={keywords} disabled={disabled} rows={3} onChange={(e) => setKeywords(e.target.value)} />
        <p className="text-xs text-muted-foreground">Comma-separated. Part of a word is fine: &ldquo;landscap&rdquo; catches landscaper and landscaping.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label="Comments a day" value={dailyCap} onChange={setDailyCap} disabled={disabled} type="number" />
        <Field label="Comments an hour" value={hourlyCap} onChange={setHourlyCap} disabled={disabled} type="number" />
        <Field label="Look every (minutes)" value={scanEvery} onChange={setScanEvery} disabled={disabled} type="number" />
        <Field label="Post from" value={activeFrom} onChange={setActiveFrom} disabled={disabled} type="time" />
        <Field label="Post until" value={activeTo} onChange={setActiveTo} disabled={disabled} type="time" />
        <Field label="Ignore posts older than (days)" value={maxAge} onChange={setMaxAge} disabled={disabled} type="number" />
      </div>

      <label className="flex items-start gap-3 text-sm">
        <Checkbox checked={pickPosts} disabled={disabled} onCheckedChange={(v) => setPickPosts(v === true)} className="mt-0.5" />
        <span>
          <span className="font-medium">Let me pick the posts.</span>
          <span className="block text-xs text-muted-foreground">
            On, and every post it reads shows under &ldquo;Posts it read&rdquo; for you to pick, and a comment is
            written only for the ones you pick. Off, and it decides for itself which posts to answer.
          </span>
        </span>
      </label>

      <label className="flex items-start gap-3 text-sm">
        <Checkbox checked={autoPost} disabled={disabled} onCheckedChange={(v) => setAutoPost(v === true)} className="mt-0.5" />
        <span>
          <span className="font-medium">Post without asking me.</span>
          <span className="block text-xs text-muted-foreground">
            Off, and every comment it writes waits under &ldquo;Comments to approve&rdquo; above until you approve it.
            On, and it posts as soon as it has written one.
          </span>
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={save} disabled={disabled}>
          {pending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
          Save
        </Button>
        {paused ? (
          <Button type="button" variant="outline" onClick={resume} disabled={disabled}>
            Resume
          </Button>
        ) : (
          <>
            <Button type="button" variant="outline" onClick={() => pause(24)} disabled={disabled}>
              Pause for a day
            </Button>
            <Button type="button" variant="outline" onClick={() => pause(null)} disabled={disabled}>
              Pause until I say
            </Button>
          </>
        )}
        {message && <span className="text-sm text-muted-foreground">{message}</span>}
      </div>
      {!owner && <p className="text-xs text-muted-foreground">Only the owner can change these.</p>}
    </div>
  );
}

function SourceRow({
  checked,
  disabled,
  onChange,
  label,
  blurb,
}: {
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
  label: string;
  blurb: string;
}) {
  return (
    <label className="flex items-start gap-3 text-sm">
      <Checkbox checked={checked} disabled={disabled} onCheckedChange={(v) => onChange(v === true)} className="mt-0.5" />
      <span>
        <span className="font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{blurb}</span>
      </span>
    </label>
  );
}

function Field({
  label,
  value,
  onChange,
  disabled,
  type,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  type: "number" | "time";
}) {
  return (
    <label className="space-y-1 text-xs">
      <span className="font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      <Input type={type} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} min={0} />
    </label>
  );
}
