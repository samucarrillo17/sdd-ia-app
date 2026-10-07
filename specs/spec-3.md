# SPEC-3: Inventario y Concurrencia

> **Stack:** NestJS + TypeORM (PostgreSQL) + class-validator (backend) · Next.js + Zod + react-hook-form (frontend, acciones mínimas)
> **Dependencias:** SPEC-1, SPEC-2

## 1. Objetivo

Formalizar la **máquina de estados** de la solicitud, manejar el **stock** con transacciones atómicas y bloqueo pesimista (`SELECT ... FOR UPDATE`) para evitar stock negativo y doble reserva, y garantizar **idempotencia** en la reserva mediante la cabecera `Idempotency-Key`.

## 2. Máquina de estados

```
BORRADOR ──► ENVIADA ──► RESERVADA ──► DESPACHADA ──► ENTREGADA
                │             │
                └─────────────┴──────► CANCELADA
(BORRADOR también puede pasar a CANCELADA por el dueño)
```

| Transición | Endpoint | Rol | Efecto sobre stock |
|---|---|---|---|
| BORRADOR → ENVIADA | `POST /requests/:id/submit` (SPEC-2) | SOLICITANTE | ninguno |
| ENVIADA → RESERVADA | `POST /requests/:id/reserve` | COORDINADOR | `reserved += qty` por ítem |
| RESERVADA → DESPACHADA | `POST /requests/:id/dispatch` | BODEGA | `on_hand -= qty` y `reserved -= qty` |
| DESPACHADA → ENTREGADA | `POST /requests/:id/deliver` | COORDINADOR, BODEGA | ninguno |
| BORRADOR/ENVIADA → CANCELADA | `POST /requests/:id/cancel` | SOLICITANTE (propia), COORDINADOR | ninguno |
| RESERVADA → CANCELADA | `POST /requests/:id/cancel` | COORDINADOR | `reserved -= qty` (libera) |

- Cualquier otra transición responde `409 INVALID_STATE_TRANSITION`.
- `DESPACHADA`, `ENTREGADA` y `CANCELADA`: no se pueden cancelar ni modificar.
- Implementar la tabla de transiciones permitidas como **una constante única** (`ALLOWED_TRANSITIONS`) usada por el servicio; no repartir `if`s por el código.

## 3. Modelo de datos

### `inventory`
| Columna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid | |
| product_id | uuid FK → products | UNIQUE `(organization_id, product_id)` |
| on_hand | int | existencia física |
| reserved | int | comprometido para solicitudes `RESERVADA` |
| version | int | `@VersionColumn` (defensa adicional) |
| updated_at | timestamptz | |

**Stock disponible = `on_hand - reserved`.**

Restricciones a nivel de BD (migración):
```sql
ALTER TABLE inventory ADD CONSTRAINT chk_on_hand_nonneg CHECK (on_hand >= 0);
ALTER TABLE inventory ADD CONSTRAINT chk_reserved_nonneg CHECK (reserved >= 0);
ALTER TABLE inventory ADD CONSTRAINT chk_reserved_le_on_hand CHECK (reserved <= on_hand);
```
> Son la última línea de defensa: aunque haya un bug en la aplicación, la BD no permite stock negativo.

### `inventory_movements` (kardex)
| Columna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid | |
| product_id | uuid | |
| request_id | uuid NULL | |
| type | enum | `RESERVA`, `LIBERACION`, `DESPACHO`, `AJUSTE` |
| quantity | int | siempre positiva; el tipo define el sentido |
| created_by | uuid | |
| created_at | timestamptz | |

### `idempotency_keys`
| Columna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid | |
| key | varchar(100) | valor de la cabecera |
| endpoint | varchar(120) | p. ej. `POST /requests/:id/reserve` |
| request_hash | char(64) | SHA-256 de `method + path + body` |
| status | enum | `IN_PROGRESS`, `COMPLETED` |
| response_status | int NULL | |
| response_body | jsonb NULL | |
| created_at | timestamptz | |

UNIQUE `(organization_id, endpoint, key)`. Limpieza de claves con más de 24 h (job opcional con `@nestjs/schedule`).

> El seed debe agregar **inventario inicial** para ORG-A y ORG-B (≥ 10 productos cada una, algunos con stock bajo para probar fallos).

## 4. Reserva atómica (`POST /requests/:id/reserve`)

Todo ocurre en **una sola transacción** (`dataSource.transaction(...)`, nivel `READ COMMITTED`):

1. **Idempotencia** (ver sección 5).
2. Bloquear la solicitud:
   ```ts
   manager.findOne(Request, {
     where: { id, organizationId },
     lock: { mode: 'pessimistic_write' },
   });
   ```
   - No existe / otra org → `404`. Estado ≠ `ENVIADA` → `409 INVALID_STATE_TRANSITION`.
3. Cargar los ítems y **bloquear las filas de `inventory` en orden determinista** (ordenadas por `product_id` ascendente) para evitar *deadlocks* entre transacciones concurrentes:
   ```ts
   manager.createQueryBuilder(Inventory, 'i')
     .setLock('pessimistic_write')
     .where('i.organization_id = :org AND i.product_id IN (:...ids)', { org, ids })
     .orderBy('i.product_id', 'ASC')
     .getMany();
   ```
4. Verificar `on_hand - reserved >= quantity` para **todos** los ítems. Si alguno falla → rollback completo y `409 INSUFFICIENT_STOCK` con detalle `[{ productId, sku, requested, available }]`. **Reserva todo o nada** (sin reservas parciales).
5. Actualizar `reserved`, insertar movimientos `RESERVA`, cambiar estado a `RESERVADA`, registrar auditoría (SPEC-4).
6. Guardar la respuesta en `idempotency_keys` (`COMPLETED`) dentro de la misma transacción.

`dispatch` y `cancel` (desde RESERVADA) siguen el mismo patrón: bloquear solicitud → bloquear inventario ordenado → modificar → movimientos → estado → auditoría.

## 5. Idempotencia

- La cabecera `Idempotency-Key` es **obligatoria** en `POST /requests/:id/reserve` (UUID recomendado, validar con `@Headers()` + pipe; ausente → `400 IDEMPOTENCY_KEY_REQUIRED`).
- Implementar como `IdempotencyInterceptor` o servicio reutilizable (`IdempotencyService.run(key, endpoint, hash, fn)`):

| Situación | Respuesta |
|---|---|
| Clave nueva | Inserta fila `IN_PROGRESS` (el UNIQUE evita carreras), ejecuta y guarda resultado |
| Misma clave + mismo hash, `COMPLETED` | Devuelve **la misma respuesta guardada** (mismo status y body), sin tocar el stock |
| Misma clave + mismo hash, `IN_PROGRESS` | `409 REQUEST_IN_PROGRESS` |
| Misma clave + hash distinto | `422 IDEMPOTENCY_KEY_REUSED` |

- Si la operación falla con error de negocio (p. ej. `INSUFFICIENT_STOCK`), la fila `IN_PROGRESS` se revierte junto con la transacción para que el cliente pueda reintentar con la misma clave tras corregir la situación.
- La clave está acotada por organización (dos orgs pueden usar la misma clave sin colisión).

## 6. Endpoints

| Método | Ruta | Roles | Cabeceras |
|---|---|---|---|
| POST | `/requests/:id/reserve` | COORDINADOR | `Idempotency-Key` (obligatoria) |
| POST | `/requests/:id/dispatch` | BODEGA | — |
| POST | `/requests/:id/deliver` | COORDINADOR, BODEGA | — |
| POST | `/requests/:id/cancel` | SOLICITANTE (propia), COORDINADOR | — |

Códigos de error del dominio: `INVALID_STATE_TRANSITION` (409), `INSUFFICIENT_STOCK` (409), `IDEMPOTENCY_KEY_REQUIRED` (400), `REQUEST_IN_PROGRESS` (409), `IDEMPOTENCY_KEY_REUSED` (422).

## 7. Frontend (acciones sobre la solicitud)

La pantalla de detalle `/requests/[id]` muestra botones según estado y rol:

| Rol | Botón | Visible cuando |
|---|---|---|
| COORDINADOR | Reservar stock | `ENVIADA` |
| BODEGA | Despachar | `RESERVADA` |
| COORDINADOR / BODEGA | Marcar entregada | `DESPACHADA` |
| COORDINADOR / SOLICITANTE (propia) | Cancelar (con confirmación) | según tabla de transiciones |

- **Idempotency-Key en el cliente:** al abrir el diálogo de reserva generar `crypto.randomUUID()` y **reutilizarlo en reintentos** del mismo intento; generar uno nuevo solo cuando el usuario inicia otra acción. Guardarlo en un `useRef`.
- Deshabilitar el botón mientras la mutación está en curso; en timeout/error de red permitir "Reintentar" con la misma clave.
- Mostrar `INSUFFICIENT_STOCK` en una lista legible (SKU, pedido, disponible).
- Zod valida las respuestas de error (`errorSchema`) antes de mostrarlas.
- Tras cada acción, invalidar las queries `['request', id]`, `['requests']` e `['inventory']`.

## 8. Pruebas requeridas (críticas)

**E2E con PostgreSQL real** (no SQLite ni mocks):
1. **Doble reserva simultánea:** dos coordinadores reservan **la misma solicitud** en paralelo (`Promise.all`) → exactamente una tiene éxito y la otra recibe 409; `reserved` queda correcto.
2. **Stock insuficiente concurrente:** dos solicitudes distintas piden el último stock del mismo SKU en paralelo → una se reserva, la otra falla; nunca `reserved > on_hand`.
3. **Todo o nada:** solicitud con 3 ítems donde el 2.º no tiene stock → ninguno queda reservado.
4. **Idempotencia:** repetir `reserve` con la misma clave 3 veces → una sola reserva y respuestas idénticas.
5. Misma clave con otra solicitud → 422. Sin cabecera → 400.
6. Ciclo completo: ENVIADA → RESERVADA → DESPACHADA → ENTREGADA con el kardex y las cantidades correctas.
7. Cancelar una RESERVADA libera el stock reservado.
8. Transiciones inválidas (p. ej. despachar una ENVIADA) → 409.
9. Los CHECK de la BD rechazan un UPDATE manual que deje `on_hand < 0`.
10. Aislamiento multi-tenant: un coordinador de ORG-B no puede reservar una solicitud de ORG-A (404).

## 9. Criterios de aceptación

- [ ] La máquina de estados está centralizada y probada.
- [ ] Reservar/despachar/cancelar son atómicos y usan bloqueo pesimista con orden determinista.
- [ ] Es imposible llegar a stock negativo o a doble reserva (tests de concurrencia en verde).
- [ ] `Idempotency-Key` evita reservas duplicadas por reintentos.
- [ ] El kardex registra cada movimiento.
- [ ] El detalle en el frontend muestra las acciones correctas por rol y estado.