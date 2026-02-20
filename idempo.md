## IdempotencyGuard — MCP Server para detectar operaciones no-idempotentes

### El problema en detalle

Un webhook de Stripe llega dos veces (pasa constantemente). Un job de BullMQ se re-ejecuta por timeout. Un retry automático reenvía un POST. El código no está preparado y duplica un cobro, crea dos usuarios, envía dos emails. Estos bugs son los más caros y los más difíciles de detectar en code review porque requieren pensar en "¿qué pasa si esto corre dos veces?", algo que ni humanos ni agentes de IA hacen consistentemente.

**Nadie lo detecta hoy:**
- Los linters no analizan semántica de negocio
- Los tests no cubren ejecución duplicada por default
- Code review lo pasa por alto el 90% del tiempo
- Los agentes de IA generan código happy-path sin pensar en re-ejecución

---

### Qué detecta

**Categoría 1 — Escrituras sin guard de unicidad**

```typescript
// PELIGRO: si el webhook llega 2 veces, 2 inserts
app.post('/webhook/stripe', async (req) => {
  const event = req.body
  await db.insert(payments).values({
    amount: event.amount,
    stripeId: event.id
  })
})
```

Detección: INSERT/CREATE sin verificación previa de existencia ni constraint UNIQUE sobre el identificador externo.

**Categoría 2 — Operaciones aritméticas no-idempotentes**

```typescript
// PELIGRO: si corre 2 veces, descuenta doble
await db.update(accounts)
  .set({ balance: sql`balance - ${amount}` })
  .where(eq(accounts.id, userId))
```

Detección: UPDATE con operación relativa (`+=`, `-=`, `balance - X`) sin idempotency key o status check previo.

**Categoría 3 — Side effects externos sin deduplicación**

```typescript
// PELIGRO: si corre 2 veces, 2 emails
await sendEmail(user.email, 'Bienvenido!')
await stripe.charges.create({ amount: 1000 })
```

Detección: llamadas a servicios externos (email, pagos, SMS, APIs) dentro de handlers que pueden re-ejecutarse sin mecanismo de deduplicación.

**Categoría 4 — Race conditions en check-then-act**

```typescript
// PELIGRO: race condition entre check y write
const exists = await db.query.payments.findFirst({
  where: eq(payments.stripeId, event.id)
})
if (!exists) {
  await db.insert(payments).values({ stripeId: event.id })
}
```

Detección: patrón SELECT + INSERT sin transacción o sin lock, vulnerable a ejecución concurrente.

**Categoría 5 — Jobs/workers sin lock distribuido**

```typescript
// PELIGRO: si el worker se reinicia, el job corre de nuevo
queue.process('send-report', async (job) => {
  const report = await generateReport(job.data.orgId)
  await emailService.send(job.data.email, report)
})
```

Detección: job processor sin idempotency key, sin status tracking, o sin mecanismo de "ya procesé esto".

---

### Cómo funciona el análisis

No es un linter de texto. Es análisis semántico en capas:

```
Código fuente
     │
     ▼
┌─────────────────┐
│  Parser          │  tree-sitter → AST
│  (multi-lenguaje)│
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Flow Analyzer   │  Identifica: handlers, jobs, crons,
│                  │  webhooks, event listeners, queue processors
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Write Detector  │  Encuentra: INSERTs, UPDATEs, API calls,
│                  │  emails, file writes, state mutations
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Guard Checker   │  ¿Hay unique constraint? ¿Lock?
│                  │  ¿Idempotency key? ¿Status check?
│                  │  ¿Transacción? ¿Upsert?
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Risk Scorer     │  Severidad: critical / warning / info
│  + Suggester     │  Sugerencia concreta de fix
└─────────────────┘
```

---

### Output del análisis

```json
{
  "file": "src/webhooks/stripe.ts",
  "function": "handlePaymentSuccess",
  "trigger_type": "webhook",
  "risks": [
    {
      "severity": "critical",
      "line": 23,
      "category": "unguarded_insert",
      "description": "INSERT into payments without uniqueness check on stripeEventId. Duplicate webhook delivery will create duplicate records.",
      "suggestion": "Use UPSERT with stripeEventId as conflict key, or add UNIQUE constraint + try/catch on conflict.",
      "fix_example": "await db.insert(payments).values({...}).onConflictDoNothing({ target: payments.stripeEventId })"
    },
    {
      "severity": "critical",
      "line": 31,
      "category": "unguarded_external_call",
      "description": "stripe.charges.create() called without idempotency key. Retry will create duplicate charge.",
      "suggestion": "Pass idempotencyKey option using the webhook event ID.",
      "fix_example": "await stripe.charges.create({ amount }, { idempotencyKey: event.id })"
    },
    {
      "severity": "warning",
      "line": 38,
      "category": "check_then_act_race",
      "description": "SELECT then INSERT without transaction. Concurrent execution can bypass the existence check.",
      "suggestion": "Wrap in transaction with SELECT FOR UPDATE, or use UPSERT."
    }
  ],
  "idempotency_score": 2,
  "verdict": "This handler is NOT safe for re-execution"
}
```

---

### MCP Server — Tools expuestos

```
check_idempotency(code, trigger_type?)
  → Analiza un bloque de código. trigger_type ayuda
    a calibrar (webhook, cron, queue, api_endpoint).

scan_handlers(repo_path, patterns?)
  → Escanea todo el repo buscando handlers, jobs,
    webhooks y analiza cada uno.

suggest_fix(code, risk)
  → Dado un riesgo detectado, genera el código
    corregido listo para aplicar.

explain_risk(category)
  → Explica un tipo de riesgo con ejemplos reales
    para que el agente entienda el contexto.
```

---

### Stack técnico

- **Bun** como runtime
- **tree-sitter** para parsing AST (soporta TS, Python, Go, Java, Ruby)
- **Patrones de detección** en JSON configurable (extensible por lenguaje/framework)
- **Zero dependencias externas** — todo corre local, no manda código a ningún server
- **MCP SDK** (`@modelcontextprotocol/sdk`)

Esto es importante: **el código del usuario nunca sale de su máquina**. Es un argumento de venta fuerte vs herramientas cloud.

---

### Patrones de detección (configurable)

```json
{
  "unguarded_insert": {
    "detect": ["db.insert", "prisma.create", ".save()", "INSERT INTO"],
    "safe_if": ["onConflict", "upsert", "ON CONFLICT", "findFirst+transaction", "UNIQUE constraint reference"],
    "severity": "critical",
    "in_contexts": ["webhook_handler", "queue_processor", "cron_job", "event_listener"]
  },
  "relative_update": {
    "detect": ["balance -", "balance +", "count +", "stock -", "SET x = x +", "increment(", "decrement("],
    "safe_if": ["idempotency_key", "status_check_before", "processed_flag"],
    "severity": "critical"
  },
  "unguarded_external_call": {
    "detect": ["sendEmail", "stripe.", "twilio.", "fetch(", "axios.", ".post(", ".put("],
    "safe_if": ["idempotencyKey", "dedup_check", "already_sent_check", "status == 'pending'"],
    "severity": "critical"
  }
}
```

El usuario puede agregar sus propios patrones para su codebase específico.

---

### Plan de ejecución

**Semana 1: Core engine**
- Setup MCP server con Bun
- Parser con tree-sitter para TypeScript
- Detector de handlers (funciones que reciben requests, jobs, events)
- Detector de escrituras (inserts, updates, API calls)

**Semana 2: Guard checker + risk scoring**
- Lógica de "¿tiene protección?" para cada categoría
- Sistema de severidad
- Generador de sugerencias de fix
- Tool `check_idempotency` funcionando end-to-end

**Semana 3: Multi-framework + scan completo**
- Soporte para Elysia, Express, Fastify, Hono (handlers HTTP)
- Soporte para BullMQ, node-cron (jobs)
- Tool `scan_handlers` para repo completo
- Patrones configurables via JSON

**Semana 4: Pulido + lanzamiento**
- README con ejemplos reales
- Publicar en npm como MCP server
- Post en dev.to / Twitter / r/programming
- Claude Code y Cursor marketplace si aplica

**Total: 4 semanas part-time** (~10-12h/semana)

**Costo: $0.** Es local, open source, sin infra.

---

### Monetización

**El MCP server es gratis y open source.** La monetización viene después:

- **IdempotencyGuard Pro** ($12-19/mes): CI integration (GitHub Action que bloquea PRs con riesgos critical), dashboard web con historial de scans por repo, soporte para más lenguajes (Python, Go, Java), patrones custom compartidos por equipo
- **IdempotencyGuard Teams** ($39/mes): reglas custom por organización, integración con Slack para alertas en PRs, métricas de "idempotency score" del codebase over time
- **Consultoría derivada**: "tu codebase tiene 47 riesgos critical, te ayudo a fixearlos" → esto solo puede ser un side income interesante

---

### Por qué puede funcionar

- **El tweet viral es obvio**: "Acabo de correr IdempotencyGuard en mi repo y encontró 23 operaciones que se pueden duplicar. Mi webhook de pagos no tenía protección alguna. 🫠" — esto se comparte solo
- **Open source primero** = adopción sin fricción, los devs lo instalan en 30 segundos
- **El dolor es universal** pero nadie lo ha empaquetado como herramienta
- **Los agentes de IA lo necesitan** porque generan código no-idempotente por default, lo cual amplifica el problema
