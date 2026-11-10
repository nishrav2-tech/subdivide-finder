// Supabase Edge Function: sf-draft
// Writes agent emails for Subdivide Finder by calling the Claude API.
// Secrets to set in Supabase (Edge Functions > Secrets):
//   ANTHROPIC_API_KEY  (required, from console.anthropic.com)
//   ANTHROPIC_MODEL    (optional, defaults to claude-sonnet-5-5)
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: userData } = await sb.auth.getUser();
  if (!userData?.user) return json({ error: "Sign in first." }, 401);
  const { data: isMember, error: memberErr } = await sb.rpc("sf_is_member");
  if (memberErr || !isMember) return json({ error: "This account is not on the Subdivide Finder team." }, 403);

  let prompt = "";
  try {
    const body = await req.json();
    prompt = typeof body?.prompt === "string" ? body.prompt : "";
  } catch (_) { /* fall through */ }
  if (!prompt || prompt.length > 60000) return json({ error: "Missing or oversized prompt." }, 400);

  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ error: "ANTHROPIC_API_KEY is not set on this function." }, 500);

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: Deno.env.get("ANTHROPIC_MODEL") ?? "claude-sonnet-5-5",
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!r.ok) {
    const detail = (await r.text()).slice(0, 300);
    return json({ error: `Claude API error ${r.status}`, detail }, 502);
  }
  const out = await r.json();
  const text = (out.content ?? []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("").trim();
  if (!text) return json({ error: "Claude returned no text." }, 502);
  return json({ text, truncated: out.stop_reason === "max_tokens" });
});
