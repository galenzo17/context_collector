## APIWatch (nombre provisional) — Deep Dive

### El dolor real

Tú integras con el ERP de un hospital. Un viernes a las 6pm el proveedor cambia el campo `product_code` a `productCode` sin avisar. Tu sistema se rompe, el hospital no puede hacer inventario el lunes, te llaman furioso. Esto le pasa a **todo dev que integra con APIs de terceros**, especialmente en LatAm donde la documentación es mala y los changelogs no existen.

---

### Cómo funciona

El usuario registra endpoints de APIs que consume. El sistema hace polling periódico, guarda snapshots de la respuesta, y compara estructura contra la versión anterior. Cuando detecta un cambio, alerta.

**Tipos de cambios detectables:**

- Campo apareció o desapareció
- Tipo de dato cambió (string → number, null donde antes no venía)
- Enum tiene valores nuevos o perdió valores
- Array cambió de estructura interna
- HTTP status code cambió
- Headers relevantes cambiaron (content-type, rate limits)
- Response time se degradó significativamente
- Schema dejó de matchear un JSON Schema que el usuario definió

---

### Arquitectura MVP

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  Dashboard   │────▶│  API (Elysia) │────▶│  Postgres   │
│   (React)    │     │              │     │  snapshots  │
└─────────────┘     └──────┬───────┘     │  rules      │
                           │             │  alerts     │
                    ┌──────▼───────┐     └─────────────┘
                    │  Scheduler   │
                    │  (cron/BullMQ)│
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐     ┌─────────────┐
                    │  Poller      │────▶│  Differ     │
                    │  (fetch)     │     │  (json-diff)│
                    └──────────────┘     └──────┬──────┘
                                                │
                                         ┌──────▼──────┐
                                         │  Notifier   │
                                         │  email/slack│
                                         │  telegram   │
                                         └─────────────┘
```

**Stack:** Bun + Elysia, Postgres (snapshots + metadata), Redis (cola de polling), React dashboard. Sin WhatsApp, sin burocracia. Email + Slack webhook + Telegram bot (los 3 son gratis y sin aprobación).

---

### Modelo de datos simplificado

```
users
  id, email, plan, stripe_customer_id

monitors
  id, user_id, name, url, method, headers_encrypted,
  body_template, interval_minutes, last_checked_at,
  expected_schema (jsonb, opcional)

snapshots
  id, monitor_id, response_status, response_headers,
  response_body (jsonb), response_time_ms, created_at

diffs
  id, monitor_id, snapshot_old_id, snapshot_new_id,
  changes (jsonb), severity, notified, created_at

channels
  id, user_id, type (email|slack|telegram), config (jsonb)

alerts
  id, diff_id, channel_id, sent_at, status
```

---

### Diff engine (el core del producto)

El diferenciador real es **qué tan inteligente es el diff**. No es solo "cambió algo", es categorizar:

- **Breaking:** campo removido, tipo cambió, status code cambió → severidad alta
- **Warning:** campo nuevo apareció, array tiene nueva estructura → severidad media
- **Info:** valor cambió pero estructura igual → severidad baja (configurable, porque a veces no te importa que el `timestamp` cambie)

El usuario configura: "ignora cambios en estos campos" (timestamps, IDs dinámicos, tokens) para evitar ruido. Esto es crítico, sin esto el producto es inutilizable.

---

### Pricing

| | Free | Pro ($12/mes) | Team ($29/mes) |
|---|---|---|---|
| Monitors | 3 | 20 | 100 |
| Polling interval | cada 6h | cada 15min | cada 5min |
| Historial | 7 días | 90 días | 1 año |
| Canales | Solo email | +Slack, Telegram | +Webhook custom |
| Ignore rules | 3 por monitor | Ilimitadas | Ilimitadas |
| Usuarios | 1 | 1 | 10 |
| Schema validation | No | Sí | Sí |

---

### Estimación de construcción

**Semana 1-2:**
- Auth, modelo de datos, CRUD de monitors
- Stripe checkout con planes
- Polling engine básico con cron

**Semana 3-4:**
- Diff engine con categorización de severidad
- Ignore rules (campos a excluir del diff)
- Notificaciones email + Slack webhook

**Semana 5-6:**
- Dashboard: lista de monitors, timeline de cambios, detalle de diff visual (lado a lado, estilo git diff pero para JSON)
- Telegram bot para alertas
- Onboarding flow

**Semana 7:**
- Landing page, docs mínimas
- Rate limiting, error handling, deploy
- Encrypted storage para headers/auth tokens de los endpoints monitoreados

**Total: ~7 semanas part-time** (~12-15h/semana)

**Costo operativo: ~$10-15 USD/mes** (VPS + dominio)

---

### El moat que puedes construir después del MVP

- **Integraciones directas:** "Monitorea la API del SII", "Monitorea Transbank", con templates pre-configurados para APIs populares en LatAm
- **GitHub Action:** corre en CI, si la API del tercero cambió, el PR no mergea hasta que revises
- **SDK que compara en runtime:** middleware que el dev instala, detecta cambios en producción real (no solo polling sintético)
- **Comunidad:** registry público de "últimos cambios detectados en APIs populares" → SEO gratuito brutal, imagina rankear para "Mercado Libre API changes 2026"

---

### Validación antes de construir

Antes de escribir una línea de código:

1. Publica en dev.to / Twitter/X un post tipo "Every time a third-party API breaks my integration without notice..." y mide reacción
2. Busca en GitHub issues de integraciones rotas por cambios no documentados, hay miles
3. Pon una landing con waitlist (usa LaunchList o hazla tú en 2 horas) y comparte en communities de devs LatAm y en r/SaaS, IndieHackers
4. Si llegas a 50-100 signups en la waitlist, construye

---

### Competencia real

- **APIdeck** — monitoring pero enfocado en unified APIs, otra cosa
- **Akita Software** — fue adquirida por Postman, ya no existe standalone
- **Optic** — open source, detecta breaking changes en TU api, no en las de terceros
- **Assertible** — testeo de APIs, no monitoring de cambios estructurales

Nadie hace exactamente "monitoreá la API del otro y avisame cuando cambie". Es un hueco real.

---

¿Arrancamos con el setup del proyecto, modelo de datos en Postgres, y el esqueleto de la API?