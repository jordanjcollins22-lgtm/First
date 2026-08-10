"use client";

import { useRef, useState, useTransition, type ChangeEvent } from "react";
import { v4 as uuid } from "uuid";
import { ImageUp } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { KitPicker } from "./kit-picker";
import { createClient } from "@/lib/supabase/client";
import { createTool } from "@/lib/actions/tool-actions";

export function CreateToolForm({ availableKits }: { availableKits: number[] }) {
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [ownership, setOwnership] = useState<"own" | "rent">("own");
  const [kits, setKits] = useState<number[]>([]);
  const [isPending, startTransition] = useTransition();

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
    });
  }

  return (
    <form ref={formRef} action={handleSubmit} className="flex flex-wrap items-end gap-3">
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
        <Input id="tool-name" name="name" required placeholder="Chainsaw" className="w-44" />
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
        <Input id="tool-cost" name="cost" type="number" step="0.01" min={0} placeholder="0.00" className="w-28" />
      </div>
      <Button type="submit" disabled={isPending}>
        {isPending ? "Adding..." : "Add Tool"}
      </Button>
    </form>
  );
}
