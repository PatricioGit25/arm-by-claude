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

async function say(visitor: string, text: string, slug = SLUG) {
  const r = await fetch(`${BASE}/api/chat/${slug}`, {
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

  console.log("\nAlquiler vacacional — familia alemana:");
  const VS = "south-costa-demo";
  const de = `smoke-de-${Date.now()}`;
  r = await say(de, "Hallo, wir suchen vom 10. bis 17. Juli für 4 Personen", VS);
  check("responde en alemán con alojamientos", /Unterkünfte|Personen|Haustier/i.test(r.reply));
  r = await say(de, "Wir möchten direkt buchen, keine Haustiere", VS);
  check("pasa al equipo: quiere reservar", r.stage === "listo", `etapa=${r.stage}`);

  console.log("\nAlquiler vacacional — incidencia:");
  const inc = `smoke-inc-${Date.now()}`;
  r = await say(inc, "Hi, I'm at Apartamento Chanquete and the air conditioning is not working", VS);
  check("crea incidencia", r.stage === "incidencia", `etapa=${r.stage}`);

  console.log("\nAlquiler vacacional — huésped sin confirmar pide el wifi:");
  const wifi = `smoke-wifi-${Date.now()}`;
  r = await say(wifi, "Hola! Estamos en Estudio Brisa, ¿cuál es la contraseña del wifi?", VS);
  check("no revela datos privados", !/4821|Brisa2027/.test(r.reply));
  check("pide confirmar la reserva", /reserva/i.test(r.reply));

  const fu = await fetch(`${BASE}/api/cron/followups`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET ?? ""}` } });
  check("cron de seguimientos", fu.ok, JSON.stringify(await fu.json()));

  console.log(failures ? `\n${failures} fallo(s)` : "\nTodo OK");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
