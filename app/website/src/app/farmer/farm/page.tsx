import { redirect } from "next/navigation";

/**
 * The farm plot view is now one place inside the island map: a farmer opens
 * their own farm on /map and gets the same crop plots in the world they
 * already navigate. The route stays so older links, bookmarks and the demo
 * script keep working.
 */
export default function FarmMapPage() {
  redirect("/map");
}
