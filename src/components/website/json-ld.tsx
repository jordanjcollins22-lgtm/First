/**
 * Structured data for search engines, as the one script tag they read.
 * "<" is escaped so nothing in the business's own text can close the tag.
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />;
}
