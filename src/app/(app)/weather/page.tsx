import { redirect } from "next/navigation";

// The forecast is a tab on the Calendar now — you check the weather to decide
// what to book. Kept as a redirect so the old link still works.
export default function WeatherRedirect() {
  redirect("/evaluations");
}
