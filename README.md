# ARM by Claude

**Automated Relationship Manager para inmobiliarias.** Un CRM en el que agentes de IA atienden a cada
comprador potencial 24/7 (en español, inglés y sueco), lo califican conversando y pasan al agente
inmobiliario **solo** a quienes de verdad van a comprar, con todo resumido. Nadie tiene que apuntar nada:
fichas, historial, etapas, seguimientos y visitas se registran solos.

> Tu CRM no le contesta a nadie a las 11 de la noche. El ARM, sí.

## Qué hace

| Función | Cómo |
|---|---|
| Responde al instante, 24/7 | Chat web (`/chat/<inmobiliaria>`) y WhatsApp Business (`/api/whatsapp`) |
| Habla el idioma del comprador | Detecta español, inglés o sueco y responde en ese idioma |
| Califica conversando | Tipo, dormitorios, zona, presupuesto, plazo, financiación y contacto. Puntaje de 0 a 100 |
| Solo recomienda propiedades reales | La IA busca en el catálogo de la inmobiliaria con herramientas y nunca inventa |
| Pasa el lead al vendedor | Al superar el umbral, o si pide visita, oferta o hablar con una persona: aviso con el resumen (y por WhatsApp si está configurado) |
| Agenda visitas | Registra la solicitud; el agente la confirma con un clic |
| Seguimiento automático | Día 3, 10, 30 y 60. Después marca "perdido (sin respuesta)" |
| Matching de propiedades nuevas | Al cargar una propiedad avisa a los leads en seguimiento que encajan |
| Resumen de la mañana | Entrados, listos para comprar, en seguimiento y **dónde se están cayendo** (embudo) |
| Multi-inmobiliaria | Cada inmobiliaria tiene su catálogo, leads, equipo, asistente y umbral de derivación |
| El humano manda | Botón para tomar la conversación (pausa la IA) y responder desde el panel |

## Modelos de IA

- **Conversación con compradores:** `claude-sonnet-5-5` (rápido y de buena calidad a un coste razonable), con herramientas
  `search_properties`, `update_lead_profile`, `schedule_visit` y `handoff_to_agent`. Fallback de servidor activado
  (`fallbacks: "default"`) por si el modelo declina un mensaje.
- **Seguimientos:** `claude-haiku-5-5` (barato, para mensajes masivos).
- Configurable con `ARM_CHAT_MODEL`, `ARM_FAST_MODEL` y `ARM_CHAT_EFFORT`.

**Sin `ANTHROPIC_API_KEY` funciona en modo demo**, con un agente de reglas que sigue el mismo flujo, para
probarlo todo sin coste.

## Arrancar en local

```bash
npm install
cp .env.example .env.local     # opcional: añade ANTHROPIC_API_KEY
npm run dev
```

- Panel: http://localhost:3000/login · demo `demo@arm.local` / `demo1234`
- Chat de comprador: http://localhost:3000/chat/costa-nerja

La base de datos local es **PGlite** (Postgres embebido en `./.data`) y se crea con datos de ejemplo de una
inmobiliaria de Nerja. En producción pon `DATABASE_URL` con un Postgres (Supabase, Neon, Railway…).

### Prueba de punta a punta

```bash
npm run build
AUTH_SECRET=x CRON_SECRET=test PORT=3100 npm start      # en otra terminal
CRON_SECRET=test npm test
```

## Producción

Variables obligatorias: `AUTH_SECRET`, `CRON_SECRET` y `DATABASE_URL`, además de `ANTHROPIC_API_KEY` para la IA real.

Programa dos llamadas con `Authorization: Bearer $CRON_SECRET`:

- `GET /api/cron/followups` cada hora (seguimientos)
- `GET /api/cron/daily` una vez al día, p. ej. a las 8:00 (resumen de la mañana)

### WhatsApp Business

1. Crea una app en Meta for Developers con WhatsApp Cloud API y un número verificado.
2. `WHATSAPP_TOKEN` (token permanente) y `WHATSAPP_VERIFY_TOKEN` en las variables de entorno.
3. Webhook: `https://tu-dominio/api/whatsapp`, suscrito a `messages`.
4. En **Ajustes** de cada inmobiliaria: su `phone_number_id` y el WhatsApp del agente que recibe los avisos.

> Meta solo permite mensajes libres durante 24 h desde el último mensaje del cliente. Para los seguimientos de
> días posteriores hace falta una plantilla aprobada (siguiente paso del roadmap).

## Estructura

```
src/lib/engine.ts        motor: entrada de mensajes, CRM automático, derivación, seguimientos, resumen
src/lib/agent/claude.ts  agente con Claude (tool use)
src/lib/agent/mock.ts    agente demo sin API key
src/lib/agent/tools.ts   herramientas del agente
src/lib/scoring.ts       puntaje de intención de compra y matching
src/lib/db/              esquema (Drizzle) y conexión PGlite/Postgres
src/app/                 panel (/app), chat público (/chat/[slug]), APIs
```

## Roadmap

- Plantillas de WhatsApp para seguimientos fuera de la ventana de 24 h
- Entrada de leads desde portales (Idealista, Fotocasa, Rightmove, Hemnet) por email o API
- Sincronización de calendario para visitas
- Panel en inglés y sueco para agentes extranjeros
- Facturación por inmobiliaria (SaaS)
