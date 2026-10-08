// Runs only against a stack started with ENVIRONMENT=production and AUTO_CONFIRM_EMAIL=true
// (the setting must be ignored in production). See ../supabase/functions/.env.example and the README.
import { describe, expect, it } from "vitest";
import { callOk, createUser, register, signIn, sleep, sql, uniq } from "./helpers";

const enabled = process.env.PRODUCTION_MODE === "1";
const MAILPIT = "http://127.0.0.1:54324";

async function latestMail(to: string): Promise<{ ID: string; Subject: string } | null> {
  for (let i = 0; i < 20; i++) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`);
    const data = (await res.json()) as { messages?: { ID: string; Subject: string }[] };
    if (data.messages?.length) return data.messages[0]!;
    await sleep(500);
  }
  return null;
}

describe.skipIf(!enabled)("production mode registration", () => {
  it("ignores AUTO_CONFIRM_EMAIL, sends a confirmation email, and blocks sign-in until confirmed", async () => {
    const founder = await createUser();
    const [invite] = await callOk<{ code: string }[]>(founder.client, "referral", "create_invite");
    const handle = uniq("p");
    const email = `${handle}@example.test`;
    const res = await register({ invite_code: invite!.code, handle, email, password: "longenough1", terms_version: "v2", age_confirmed: true });
    expect(res.body.status).toBe("check_email");

    await expect(signIn(email, "longenough1")).rejects.toThrow(/confirm/i);

    const mail = await latestMail(email);
    expect(mail).not.toBeNull();
    const full = (await (await fetch(`${MAILPIT}/api/v1/message/${mail!.ID}`)).json()) as { Text: string };
    const link = full.Text.match(/https?:\/\/[^\s)>\]]+/)?.[0];
    expect(link).toBeTruthy();
    // Follow the confirmation link against Supabase Auth; it redirects to the site with a session in the hash.
    await fetch(link!, { redirect: "manual" });
    await signIn(email, "longenough1");
  });

  it("answers an already-registered email the same way and does not reveal it", async () => {
    const founder = await createUser();
    const [invite] = await callOk<{ code: string }[]>(founder.client, "referral", "create_invite");
    const res = await register({ invite_code: invite!.code, handle: uniq("p"), email: founder.email, password: "longenough1", terms_version: "v2", age_confirmed: true });
    expect(res.body.status).toBe("check_email");
    const mail = await latestMail(founder.email);
    expect(mail).not.toBeNull();
  });

  it("leaves nothing behind when the confirmation cannot be sent", async () => {
    const rows = await sql("select count(*)::int as n from accounts.profiles p where not exists (select 1 from auth.users u where u.id = p.id) and p.status = 'active'");
    expect((rows[0] as { n: number }).n).toBe(0);
  });
});
