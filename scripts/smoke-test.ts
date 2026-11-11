/**
 * Prueba de punta a punta contra un servidor en marcha:
 *   npm run build && PORT=3100 npm start   (en otra terminal)
 *   BASE=http://localhost:3100 npm test
 */
const BASE = process.env.BASE ?? "http://localhost:3100";
const SLUG = process.env.SLUG ?? "costa-nerja";

let failures = 0;
function check(name: string, ok: boolean, extra = "") {
  console.log(`${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
  if (!ok) failures++;
}

async function say(visitor: string, text: string) {
  const r = await fetch(`${BASE}/api/chat/${SLUG}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ visitor, text }),
  });
  const j = (await r.json()) as { reply: string; stage: string; score: number; engine: string };
  console.log(`  👤 ${text}\n  🤖 [${j.engine}] ${j.reply?.replace(/\n/g, "\n     ")}\n     → etapa=${j.stage} puntaje=${j.score}`);
  return j;
}

async function main() {
  check("landing", (await fetch(BASE)).ok);
  check("chat público", (await fetch(`${BASE}/chat/${SLUG}`)).ok);

  console.log("\nComprador sueco serio:");
  const sv = `smoke-sv-${Date.now()}`;
  let r = await say(sv, "Hej! Jag letar efter en lägenhet med 2 sovrum i Nerja");
  check("responde en sueco", /hej|sovrum|lägenhet|budget/i.test(r.reply));
  r = await say(sv, "Max 300 000 euro, vi betalar kontant");
  r = await say(sv, "Vi vill köpa inom 2 månader. Jag heter Lars, +46 70 111 22 33");
  check("pasa a vendedor (listo/visita)", ["listo", "visita"].includes(r.stage), `etapa=${r.stage}`);

  console.log("\nCurioso en español:");
  const es = `smoke-es-${Date.now()}`;
  r = await say(es, "Hola, ¿qué tenéis por Frigiliana?");
  check("responde en español", /hola|frigiliana|tipo|propiedad/i.test(r.reply));
  check("no lo pasa todavía", !["listo", "visita"].includes(r.stage), `etapa=${r.stage}`);

  const hist = await (await fetch(`${BASE}/api/chat/${SLUG}?visitor=${sv}`)).json() as { messages: unknown[] };
  check("historial guardado solo", hist.messages.length >= 6, `${hist.messages.length} mensajes`);

  const fu = await fetch(`${BASE}/api/cron/followups`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET ?? ""}` } });
  check("cron de seguimientos", fu.ok, JSON.stringify(await fu.json()));

  console.log(failures ? `\n${failures} fallo(s)` : "\nTodo OK");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
