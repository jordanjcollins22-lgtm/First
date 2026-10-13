import { V2PagesNav } from "@/components/v2/v2-pages-nav";

/** The four-page bar, shared by every page of the new layout so it never waits on a page's data. */
export default function V2Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 pt-5">
      <V2PagesNav />
      {children}
    </div>
  );
}
