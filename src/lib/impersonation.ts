import { cookies } from "next/headers";

const COOKIE_NAME = "view_as_profile_id";

export async function getViewAsProfileId(): Promise<string | null> {
  const store = await cookies();
  return store.get(COOKIE_NAME)?.value ?? null;
}

export async function setViewAsProfileId(profileId: string) {
  const store = await cookies();
  store.set(COOKIE_NAME, profileId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 8,
  });
}

export async function clearViewAsProfileId() {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}
