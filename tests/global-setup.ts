import { sql } from "./helpers";

// Rate limit counters live in the database and survive restarts; start every run from zero.
export default async function setup() {
  await sql("truncate private.rate_limits");
}
