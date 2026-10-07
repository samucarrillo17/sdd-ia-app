# SPEC-5: Asistente de IA

> **Stack:** NestJS + class-validator / class-transformer (backend) · Next.js + Zod + react-hook-form (frontend)
> **Dependencias:** SPEC-1, SPEC-2, SPEC-3, SPEC-4

## 1. Objetivo

Exponer `POST /ai/summaries`, que toma **hasta 20 solicitudes `ENVIADA`**, llama a un proveedor de IA (o a un **mock/fixture**) y devuelve un **resumen con recomendaciones**. Si la IA tarda más de **5 segundos**, falla o responde un **JSON inválido**, el sistema ejecuta automáticamente un **algoritmo determinista** de respaldo (fallback) sin romperse.

## 2. Backend

### 2.1 Estructura

```
apps/api/src/ai/
├── ai.module.ts
├── ai.controller.ts
├── ai.service.ts                 # orquestación + fallback
├── providers/
│   ├── ai-provider.interface.ts
│   ├── http-ai.provider.ts       # proveedor real (HTTP)
│   └── mock-ai.provider.ts       # fixture determinista
├── fallback/
│   └── priority-fallback.ts      # algoritmo determinista (función pura)
├── dto/
│   ├── create-summary.dto.ts
│   └── ai-response.dto.ts        # valida la respuesta de la IA
└── fixtures/ai-summary.fixture.json
```

### 2.2 Endpoint

`POST /ai/summaries` — Rol: **COORDINADOR**.

**Body (opcional):**
```ts
export class CreateSummaryDto {
  @IsOptional() @IsArray() @ArrayMaxSize(20) @ArrayUnique()
  @IsUUID('4', { each: true })
  requestIds?: string[];
}
```
- Si se envían `requestIds`: todos deben ser de la organización del usuario y estar en estado `ENVIADA` (si alguno no cumple → `400/404`).
- Si no se envían: se toman las **20 solicitudes `ENVIADA` más antiguas** de la organización (orden: prioridad, `needed_by`, `created_at`).
- Si no hay solicitudes `ENVIADA` → `200` con `source: "fallback"`, listas vacías y un resumen que lo indique (no es un error).
- Más de 20 `requestIds` → `400`.

**Respuesta (siempre la misma forma):**
```json
{
  "source": "ai",                  // "ai" | "fallback"
  "fallbackReason": null,          // "TIMEOUT" | "PROVIDER_ERROR" | "INVALID_RESPONSE" | null
  "summary": "Texto del resumen...",
  "recommendations": [
    { "requestId": "uuid", "rank": 1, "action": "RESERVAR", "reason": "Prioridad ALTA y fecha límite en 2 días." }
  ],
  "generatedAt": "2026-10-06T12:00:00.000Z",
  "requestCount": 12
}
```
`action` ∈ `RESERVAR | REVISAR | POSTERGAR`.

### 2.3 Proveedor de IA

```ts
export interface AiProvider {
  summarize(input: AiSummaryInput, signal: AbortSignal): Promise<unknown>;
}
```
- Selección por variable de entorno `AI_PROVIDER=mock | http` (inyección con un provider token de Nest). **Por defecto `mock`** en desarrollo y tests.
- `HttpAiProvider`: URL, modelo y API key vía `ConfigService` (`AI_API_URL`, `AI_API_KEY`, `AI_MODEL`); la clave nunca se registra en logs.
- `MockAiProvider`: devuelve el fixture; soporta **modos de falla** controlados por una variable (`AI_MOCK_MODE=ok | slow | error | invalid-json`) para probar cada ruta del fallback sin depender de un servicio externo.
- **Datos enviados a la IA:** solo lo necesario (id, código, prioridad, `neededBy`, lista de SKU+cantidad, disponibilidad). Nada de emails, nombres ni datos personales.
- **Seguridad frente a prompt injection:** el campo `notes` es texto libre del usuario; incluirlo solo como dato dentro de un bloque delimitado, indicando en el prompt de sistema que debe tratarse como contenido no confiable y nunca como instrucciones. La respuesta de la IA nunca ejecuta acciones por sí misma: solo es informativa.

### 2.4 Timeout y fallback

```ts
async summarize(user, dto) {
  const requests = await this.loadRequests(user, dto);
  try {
    const raw = await this.callWithTimeout(requests, 5000);   // AbortSignal.timeout(5000)
    const parsed = await this.validateAiResponse(raw, requests); // class-transformer + class-validator
    return this.buildResponse('ai', null, parsed);
  } catch (err) {
    const reason = classify(err); // TIMEOUT | PROVIDER_ERROR | INVALID_RESPONSE
    this.logger.warn({ reason }, 'AI fallback activated');
    return this.buildResponse('fallback', reason, priorityFallback(requests));
  }
}
```

- **Timeout duro de 5000 ms** con `AbortSignal.timeout(5000)` (se cancela la petición real, no solo se ignora).
- **Validación estricta de la respuesta** (`plainToInstance` + `validate` sobre `AiResponseDto`):
  - JSON parseable; `summary` string no vacío (máx. 2000 caracteres);
  - `recommendations` array donde cada `requestId` **pertenece al conjunto enviado** (descartar o invalidar IDs inventados), sin duplicados, `action` dentro del enum, `rank` entero ≥ 1.
  - Si falla cualquier regla → `INVALID_RESPONSE` → fallback.
- Errores HTTP/red del proveedor → `PROVIDER_ERROR` → fallback.
- **El endpoint nunca responde 5xx por culpa de la IA.** Sin reintentos (el presupuesto total es de 5 s).

### 2.5 Algoritmo determinista (fallback)

Función **pura** `priorityFallback(requests)`:

1. Ordenar por:
   1. Prioridad: `ALTA` → `MEDIA` → `BAJA`.
   2. `neededBy` ascendente (la fecha más cercana primero).
   3. `createdAt` ascendente.
   4. `id` ascendente (desempate final para que el resultado sea 100 % reproducible).
2. Asignar `rank` 1..n y una acción:
   - `RESERVAR` si hay stock disponible para todos los ítems;
   - `REVISAR` si falta stock en algún ítem;
   - `POSTERGAR` si la prioridad es `BAJA` y `neededBy` está a más de 14 días.
3. Construir `summary` con una plantilla fija: total de solicitudes, cantidad por prioridad, cuántas vencen en ≤ 3 días y cuántas tienen faltante de stock.
4. `reason` de cada recomendación con una plantilla fija (p. ej. `"Prioridad ALTA, necesaria en 2 días."`).

Misma entrada ⇒ misma salida, sin usar fecha/hora actual de forma implícita (recibir `now` como parámetro para poder testear).

### 2.6 Otros requisitos

- Rate limit del endpoint (`@nestjs/throttler`, p. ej. 10/min por usuario) para controlar el costo.
- Registrar en auditoría (SPEC-4) la acción `AI_SUMMARY_GENERATED` con `source`, `fallbackReason`, `requestCount` (sin guardar el texto completo del prompt).
- Métricas/logs: duración de la llamada, `source`, `fallbackReason`.

## 3. Frontend (Next.js)

```
apps/web/src/
├── features/ai/
│   ├── ai-summary-panel.tsx
│   ├── use-ai-summary.ts        # useMutation
│   └── ...
└── lib/schemas/ai.ts            # Zod
```

- En el tablero (SPEC-4), pestaña/panel **"Asistente"** visible solo para COORDINADOR.
- Permitir seleccionar hasta 20 solicitudes `ENVIADA` de la lista (checkbox; contador "N/20", deshabilitar al llegar al límite) o usar el botón **"Resumir las pendientes"** (sin selección). Si se usa `react-hook-form`, el esquema Zod limita `requestIds` a `max(20)`.
- Estado de carga con indicador (la espera puede llegar a ~5 s) y botón deshabilitado durante la petición.
- Validar la respuesta con Zod (`aiSummaryResponseSchema`); si no coincide, mostrar un error genérico en lugar de romper la UI.
- Mostrar una **insignia de origen**: "Generado por IA" o "Respaldo automático" (con el motivo en un tooltip accesible: tiempo agotado / error del proveedor / respuesta inválida).
- Lista de recomendaciones ordenada por `rank`, con enlace al detalle de cada solicitud y botón **"Reservar"** que lleva al flujo de SPEC-3 (la IA recomienda; el humano ejecuta).
- Aviso visible: "Las recomendaciones son orientativas".
- Accesible por teclado y responsive (390px / 1366px).

## 4. Pruebas requeridas

**Unitarias:**
- `priorityFallback`: orden por prioridad → fecha → creación → id; mismo input = mismo output; lista vacía; exactamente 20 elementos; empates completos.
- Validador de respuesta de IA: rechaza JSON malformado, `requestId` ajeno, duplicados, `action` inválida, `summary` vacío.

**E2E (con `MockAiProvider`):**
| Escenario | Resultado esperado |
|---|---|
| `AI_MOCK_MODE=ok` | `source: "ai"`, `fallbackReason: null` |
| `slow` (> 5 s) | `source: "fallback"`, `TIMEOUT`, respuesta en ≈ 5 s (no mucho más) |
| `error` | `source: "fallback"`, `PROVIDER_ERROR` |
| `invalid-json` | `source: "fallback"`, `INVALID_RESPONSE` |
| IA devuelve `requestId` inventado | `INVALID_RESPONSE` → fallback |
- 21 `requestIds` → 400. Solicitud de otra org o no `ENVIADA` → rechazada.
- SOLICITANTE/BODEGA/AUDITOR → 403.
- Sin solicitudes pendientes → 200 con resumen vacío.
- Se registra auditoría `AI_SUMMARY_GENERATED`.

**Frontend:** render con `source: "ai"` y `"fallback"`, límite de 20 selecciones, respuesta inválida manejada sin romper.

## 5. Criterios de aceptación

- [ ] `POST /ai/summaries` procesa hasta 20 solicitudes `ENVIADA` de la organización del usuario.
- [ ] Ante timeout (5 s), error o JSON inválido, siempre responde 200 con el resultado del algoritmo determinista.
- [ ] El fallback es una función pura, reproducible y cubierta por tests.
- [ ] La respuesta de la IA se valida estrictamente y no puede referenciar solicitudes ajenas.
- [ ] No se envían datos personales al proveedor; las claves viven solo en variables de entorno.
- [ ] La UI indica claramente si el resultado vino de la IA o del respaldo.