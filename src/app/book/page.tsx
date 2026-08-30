import { Suspense } from "react";

import { BookingForm, BookingFormSkeleton } from "./booking-form";

/**
 * The public booking page.
 *
 * There is nothing here that varies by visitor, so there is nothing here to
 * render per request: this page is prerendered at build time and served from
 * the edge cache rather than from the application server. That is the whole
 * point of the file being this short. It used to await four Supabase queries
 * before the first byte left, on the one page in the app that gets opened by
 * people who are deciding whether to bother with us.
 *
 * The Suspense boundary is what makes it possible. BookingForm reads the
 * ?ref= / ?org= off the URL, which is a browser-only value; without a
 * boundary that would drag the whole route back to being rendered per
 * request, and with one, the skeleton is prerendered in its place and the
 * form takes over on the client.
 */
export default function BookPage() {
  return (
    <Suspense fallback={<BookingFormSkeleton />}>
      <BookingForm />
    </Suspense>
  );
}
