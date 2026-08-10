"use client";

import { useRef, useState, useTransition, type ChangeEvent } from "react";
import { v4 as uuid } from "uuid";
import { ImageUp, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { KitPicker } from "./kit-picker";
import { createClient } from "@/lib/supabase/client";
import { createTool } from "@/lib/actions/tool-actions";
import { fetchLinkPreview } from "@/lib/actions/link-preview-actions";

export function CreateToolForm({ availableKits }: { availableKits: number[] }) {
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const costRef = useRef<HTMLInputElement>(null);
  const purchaseUrlRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [ownership, setOwnership] = useState<"own" | "rent">("own");
  const [kits, setKits] = useState<number[]>([]);
  const [isPending, startTransition] = useTransition();
  const [fetching, setFetching] = useState(false);
  const [fetchMessage, setFetchMessage] = useState<string | null>(null);

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0] ?? null;
    setFile(picked);
    setPreviewUrl(picked ? URL.createObjectURL(picked) : null);
  }

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      if (file) {
        const supabase = createClient();
        const path = `${uuid()}/${file.name}`;
        const { error } = await supabase.storage.from("tool-images").upload(path, file, { upsert: false });
        if (!error) formData.set("image_path", path);
      }
      formData.set("is_rental", ownership === "rent" ? "on" : "");
      formData.set("kits", kits.join(","));
      await createTool(formData);
      formRef.current?.reset();
      setFile(null);
      setPreviewUrl(null);
      setOwnership("own");
      setKits([]);
      setFetchMessage(null);
    });
  }

  async function handleFetchDetails() {
    const url = purchaseUrlRef.current?.value.trim();
    if (!url) {
      setFetchMessage("Paste a purchase link first.");
      return;
    }
    setFetching(true);
    setFetchMessage(null);
    try {
      const preview = await fetchLinkPreview(url);
      const found: string[] = [];
      if (preview.title && nameRef.current && !nameRef.current.value.trim()) {
        nameRef.current.value = preview.title;
        found.push("name");
      }
      if (preview.price != null && costRef.current) {
        costRef.current.value = preview.price.toString();
        found.push("cost");
      }
      setFetchMessage(
        found.length > 0
          ? `Filled in ${found.join(", ")} from the link.`
          : "Couldn't find a price automatically — enter it manually."
      );
    } catch {
      setFetchMessage("Couldn't reach that link — enter details manually.");
    } finally {
      setFetching(false);
    }
  }

  return (
    <form ref={formRef} action={handleSubmit} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label>Image</Label>
          <div className="flex items-center gap-2">
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewUrl} alt="" className="h-12 w-12 rounded-md border border-border object-cover" />
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex h-12 w-12 flex-col items-center justify-center gap-0.5 rounded-md border border-dashed border-border text-muted-foreground hover:bg-accent"
              >
                <ImageUp className="h-4 w-4" />
                <span className="text-[9px]">Add</span>
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileChange}
            />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tool-name">Name</Label>
          <Input id="tool-name" name="name" ref={nameRef} required placeholder="Chainsaw" className="w-44" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Kit(s)</Label>
          <KitPicker availableKits={availableKits} value={kits} onChange={setKits} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tool-own-rent">Own or Rent</Label>
          <Select value={ownership} onValueChange={(v) => setOwnership(v as "own" | "rent")}>
            <SelectTrigger id="tool-own-rent" className="h-11 w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="own">Own</SelectItem>
              <SelectItem value="rent">Rent</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tool-cost">Cost</Label>
          <Input
            id="tool-cost"
            name="cost"
            ref={costRef}
            type="number"
            step="0.01"
            min={0}
            placeholder="0.00"
            className="w-28"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tool-storage">Stored at</Label>
          <Input
            id="tool-storage"
            name="storage_location"
            placeholder="e.g. Shop shelf 3, Truck 1"
            className="w-40"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tool-purchase-url">Purchase link</Label>
          <div className="flex gap-2">
            <Input
              id="tool-purchase-url"
              name="purchase_url"
              ref={purchaseUrlRef}
              type="url"
              placeholder="https://..."
              className="w-64"
            />
            <Button type="button" variant="secondary" disabled={fetching} onClick={handleFetchDetails}>
              <Search className="h-4 w-4" />
              {fetching ? "Fetching..." : "Fetch details"}
            </Button>
          </div>
        </div>
        <Button type="submit" disabled={isPending}>
          {isPending ? "Adding..." : "Add Tool"}
        </Button>
      </div>
      {fetchMessage && <p className="text-xs text-muted-foreground">{fetchMessage}</p>}
    </form>
  );
}
