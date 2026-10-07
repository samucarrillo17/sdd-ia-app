# SPEC-4: Tablero, Consultas y Auditoría

> **Stack:** NestJS + TypeORM + class-validator + `@nestjs/terminus` (backend) · Next.js + Zod + react-hook-form + TanStack Query (frontend)
> **Dependencias:** SPEC-1, SPEC-2, SPEC-3

## 1. Objetivo

Construir el tablero para consultar solicitudes (con filtros), existencias del inventario e historial de cambios; con **paginación (máx. 100)**, una **tabla de auditoría inmutable** y los endpoints `/health` y `/ready`.

## 2. Backend: paginación y filtros

### 2.1 DTO base de paginación (reutilizable)

```ts
export class PaginationQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page: number = 1;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit: number = 20;                  // máximo 100: si piden más → 400
}
```

Respuesta estándar:
```json
{ "data": [...], "meta": { "page": 1, "limit": 20, "total": 134, "totalPages": 7 } }
```

Crear un helper `paginate(queryBuilder, dto)` que use `skip/take` y `getManyAndCount()`, con **orden determinista** (siempre desempatar por `id`).

### 2.2 Endpoints de consulta

| Método | Ruta | Roles | Filtros (query params) |
|---|---|---|---|
| GET | `/requests` | todos (SOLICITANTE ve solo las suyas) | `status[]`, `priority[]`, `requesterId`, `neededFrom`, `neededTo`, `createdFrom`, `createdTo`, `search` (por código), `sortBy` (`createdAt`\|`neededBy`\|`priority`), `sortDir`, `page`, `limit` |
| GET | `/inventory` | todos | `search` (SKU o nombre), `lowStock` (boolean: disponible ≤ umbral), `page`, `limit` |
| GET | `/requests/:id/history` | todos los que pueden ver la solicitud | `page`, `limit` (atajo de `/audit-logs` filtrado por entidad) |
| GET | `/audit-logs` | COORDINADOR, AUDITOR | `entityType`, `entityId`, `actorId`, `action`, `from`, `to`, `page`, `limit` |

- Whitelist estricta de `sortBy` (nunca concatenar texto del cliente en SQL).
- Todos los filtros se aplican **además** del filtro por `organization_id` de la sesión.
- Filas de `/requests`: `id, code, status, priority, neededBy, requester { id, fullName }, itemsCount, createdAt`.
- Filas de `/inventory`: `productId, sku, name, onHand, reserved, available`.
- Índices recomendados: `(organization_id, status, created_at DESC)`, `(organization_id, priority, needed_by)`, índice `pg_trgm` opcional para `search`.

## 3. Backend: auditoría inmutable

### 3.1 Tabla `audit_logs`
| Columna | Tipo | Notas |
|---|---|---|
| id | bigserial PK | |
| organization_id | uuid | índice |
| actor_user_id | uuid NULL | NULL solo para acciones del sistema |
| entity_type | varchar(40) | `REQUEST`, `INVENTORY`, `USER`, ... |
| entity_id | uuid | índice `(organization_id, entity_type, entity_id, created_at)` |
| action | varchar(60) | `REQUEST_CREATED`, `REQUEST_SUBMITTED`, `STOCK_RESERVED`, `STOCK_DISPATCHED`, `REQUEST_CANCELLED`, `LOGIN`, ... |
| before | jsonb NULL | estado anterior (campos relevantes) |
| after | jsonb NULL | estado posterior |
| request_id | varchar(64) NULL | correlación (header `X-Request-Id` o generado) |
| ip | inet NULL | |
| created_at | timestamptz | default `now()` |

### 3.2 Inmutabilidad (doble protección)

1. **A nivel de BD** (migración): trigger que rechaza modificaciones.
   ```sql
   CREATE OR REPLACE FUNCTION audit_logs_immutable() RETURNS trigger AS $$
   BEGIN
     RAISE EXCEPTION 'audit_logs es inmutable (% no permitido)', TG_OP;
   END; $$ LANGUAGE plpgsql;

   CREATE TRIGGER trg_audit_logs_no_update_delete
     BEFORE UPDATE OR DELETE ON audit_logs
     FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();

   CREATE TRIGGER trg_audit_logs_no_truncate
     BEFORE TRUNCATE ON audit_logs
     FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_immutable();
   ```
   (Opcional: revocar `UPDATE/DELETE/TRUNCATE` al rol de la aplicación.)
2. **A nivel de aplicación:** `AuditLog` sin endpoints de escritura, el repositorio solo expone `insert`/consultas; sin `@UpdateDateColumn`.

### 3.3 `AuditService`

```ts
record(manager: EntityManager, entry: {
  organizationId: string; actorUserId: string | null;
  entityType: string; entityId: string; action: string;
  before?: object | null; after?: object | null;
}): Promise<void>
```

- Recibe el `EntityManager` de la transacción en curso para que **el cambio y su auditoría se confirmen o se revierten juntos**.
- **Tarea de integración:** conectar `AuditService.record` en todas las operaciones de escritura de SPEC-2 (crear, editar, eliminar, enviar) y SPEC-3 (reservar, despachar, entregar, cancelar), y en login/logout de SPEC-1.
- Nunca guardar contraseñas, tokens ni hashes en `before/after`.

## 4. Backend: salud

Usar `@nestjs/terminus`. Ambos endpoints son `@Public()` y sin prefijo de autenticación.

| Ruta | Propósito | Comportamiento |
|---|---|---|
| `GET /health` | Liveness | `200 { status: 'ok' }` si el proceso responde. No consulta la BD. |
| `GET /ready` | Readiness | Verifica conexión a PostgreSQL (`TypeOrmHealthIndicator.pingCheck('database', { timeout: 1500 })`) y que no haya migraciones pendientes. `200` si todo bien, `503` si no. |

## 5. Frontend (Next.js)

### 5.1 Estructura

```
apps/web/src/
├── app/(app)/
│   ├── dashboard/page.tsx          # tablero con pestañas
│   └── requests/[id]/history/...   # o pestaña dentro del detalle
├── features/dashboard/
│   ├── requests-table.tsx
│   ├── request-filters.tsx         # react-hook-form + Zod
│   ├── inventory-table.tsx
│   ├── audit-timeline.tsx
│   └── pagination.tsx
└── lib/schemas/{pagination,filters,audit}.ts
```

### 5.2 Comportamiento

- **Pestañas:** *Solicitudes*, *Inventario*, *Auditoría* (esta última solo visible para COORDINADOR y AUDITOR).
- **Filtros** con `react-hook-form` + `zodResolver` (`filtersSchema` con `status`, `priority`, rango de fechas, búsqueda). Se **sincronizan con la URL** (`useSearchParams`/`router.replace`) para poder compartir enlaces; debounce de 300 ms en búsqueda de texto.
- **Paginación** del lado servidor: selector de tamaño (10/20/50/100), anterior/siguiente, indicador "Mostrando X–Y de Z". Al cambiar filtros vuelve a la página 1.
- **TanStack Query** con `placeholderData: keepPreviousData` para evitar parpadeos; estados de carga (skeletons), vacío y error con reintento.
- Todas las respuestas del backend se parsean con **Zod** antes de usarse.
- **Inventario:** columnas SKU, nombre, físico, reservado, disponible; resaltar stock bajo.
- **Historial/auditoría:** línea de tiempo con acción legible, actor, fecha relativa y detalle expandible del `before/after` (diff simple).
- Responsive: en 390px las tablas se transforman en tarjetas; en 1366px tablas completas. Controles operables con teclado.

## 6. Pruebas requeridas

**Backend (E2E):**
- `limit=101` → 400; `limit=100` → 200; sin parámetros → defaults (page 1, limit 20).
- Paginación estable: recorrer todas las páginas no repite ni omite filas.
- Un SOLICITANTE solo ve sus solicitudes en `/requests`; COORDINADOR/BODEGA/AUDITOR ven todas las de su org; nadie ve datos de otra org.
- `sortBy` inválido → 400.
- **Auditoría:** cada operación de escritura (SPEC-2/3) genera su registro con actor, `before` y `after`; si la transacción falla, no queda registro.
- `UPDATE`, `DELETE` y `TRUNCATE` sobre `audit_logs` fallan (probar con SQL directo).
- SOLICITANTE y BODEGA reciben 403 en `/audit-logs`.
- `/health` responde 200 sin sesión; `/ready` responde 503 cuando la BD no está disponible.

**Frontend:** filtros ↔ URL, cambio de página, estados vacío/error, visibilidad de pestañas por rol.

## 7. Criterios de aceptación

- [ ] Ningún endpoint de listado devuelve más de 100 elementos.
- [ ] `audit_logs` es inmutable por trigger y por diseño de la aplicación.
- [ ] Todas las escrituras de SPEC-1/2/3 quedan auditadas dentro de su misma transacción.
- [ ] El tablero filtra solicitudes, muestra existencias e historial con paginación del servidor.
- [ ] `/health` y `/ready` funcionan y distinguen liveness de readiness.