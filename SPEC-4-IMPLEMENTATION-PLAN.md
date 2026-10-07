# Plan de implementación SPEC-4: Tablero, Consultas y Auditoría

## Resumen
Implementar paginación reutilizable, endpoints de consulta filtrados, auditoría inmutable, endpoints de salud y tablero frontend con TanStack Query.

---

## PASOS DE BACKEND

### Paso 1: Migración de auditoría (`audit_logs` + triggers inmutabilidad)
- **Archivo**: `apps/api/src/database/migrations/1700000000003-AuditLogs.ts`
- Crear tabla `audit_logs` según spec (bigserial PK, índices compuestos)
- Crear función PL/pgSQL `audit_logs_immutable()` y triggers BEFORE UPDATE/DELETE/TRUNCATE
- Agregar entidad `AuditLog` en `apps/api/src/audit/audit-log.entity.ts`
- Registrar migración en `data-source.ts`

### Paso 2: DTO de paginación reutilizable + helper `paginate`
- **Archivo**: `apps/api/src/common/dto/pagination-query.dto.ts`
- `PaginationQueryDto` con `page` (default 1) y `limit` (default 20, max 100)
- **Archivo**: `apps/api/src/common/utils/pagination.ts`
- Helper `paginate(queryBuilder, dto, defaultSortBy?)` que usa `skip/take` + `getManyAndCount()` y orden determinista (desempatar por `id`)

### Paso 3: Módulo de auditoría (`AuditModule`, `AuditService`, `AuditController`)
- **Archivo**: `apps/api/src/audit/audit.service.ts`
  - `record(manager, entry)` — inserta dentro de la transacción activa
  - Sanitiza `before`/`after`: elimina `password`, `passwordHash`, `token`, `hash`, `secret`
- **Archivo**: `apps/api/src/audit/audit.controller.ts`
  - `GET /audit-logs` con filtros: `entityType`, `entityId`, `actorId`, `action`, `from`, `to`, `page`, `limit`
  - Whitelist estricta de `sortBy`: `createdAt` | `entityType` | `action`
  - Roles: COORDINADOR, AUDITOR
- **Archivo**: `apps/api/src/audit/audit.module.ts`

### Paso 4: Endpoints de consulta en módulos existentes
#### 4.1 ProductsModule → `GET /products` (ya existe, añadir paginación DTO)
- Ya implementado en SPEC-2, verificar que use `PaginationQueryDto`

#### 4.2 RequestsModule → nuevos endpoints
- **Archivo**: `apps/api/src/requests/dto/list-requests-query.dto.ts`
  - Extiende `PaginationQueryDto` + filtros: `status[]`, `priority[]`, `requesterId`, `neededFrom`, `neededTo`, `createdFrom`, `createdTo`, `search`, `sortBy`, `sortDir`
  - Whitelist `sortBy`: `createdAt` | `neededBy` | `priority`
- **Archivo**: `apps/api/src/requests/requests.controller.ts` (añadir)
  - `GET /requests` — usa helper `paginate`, filtra por org + rol (SOLICITANTE ve solo propias)
  - `GET /requests/:id/history` — atajo a `/audit-logs` filtrado por `entityType=REQUEST` y `entityId=:id`
- **Archivo**: `apps/api/src/requests/requests.service.ts` (añadir métodos `findAll`, `findHistory`)

#### 4.3 InventoryModule → nuevo endpoint
- **Archivo**: `apps/api/src/inventory/dto/list-inventory-query.dto.ts`
  - Extiende `PaginationQueryDto` + `search`, `lowStock` (boolean)
- **Archivo**: `apps/api/src/inventory/inventory.controller.ts` (añadir)
  - `GET /inventory` — devuelve `productId, sku, name, onHand, reserved, available`
- **Archivo**: `apps/api/src/inventory/inventory.service.ts` (añadir `findAllPaginated`)

### Paso 5: Integración de `AuditService.record` en escrituras
Modificar servicios existentes para llamar `auditService.record(manager, {...})` dentro de sus transacciones:

| Operación | Archivo | Acción de auditoría |
|-----------|---------|---------------------|
| Login | `auth.service.ts` → `login()` | `LOGIN`, `after`: {userId, email, role} |
| Logout | `auth.service.ts` → `logout()` | `LOGOUT`, `before`: {sessionId} |
| Crear solicitud | `requests.service.ts` → `create()` | `REQUEST_CREATED`, `after`: request DTO |
| Editar solicitud | `requests.service.ts` → `update()` | `REQUEST_UPDATED`, `before`/`after` |
| Eliminar solicitud | `requests.service.ts` → `delete()` | `REQUEST_DELETED`, `before`: request DTO |
| Enviar solicitud | `requests.service.ts` → `submit()` | `REQUEST_SUBMITTED`, `before`/`after` status |
| Reservar | `requests.service.ts` → `reserve()` | `STOCK_RESERVED`, `after`: items reservados |
| Despachar | `requests.service.ts` → `dispatch()` | `STOCK_DISPATCHED`, `after`: items despachados |
| Entregar | `requests.service.ts` → `deliver()` | `REQUEST_DELIVERED`, `before`/`after` status |
| Cancelar | `requests.service.ts` → `cancel()` | `REQUEST_CANCELLED`, `before`/`after` + stock liberado si aplica |

### Paso 6: Endpoints de salud (`HealthModule`)
- **Archivo**: `apps/api/src/health/health.controller.ts`
  - `GET /health` — `@Public()`, liveness: `{ status: 'ok' }`
  - `GET /ready` — `@Public()`, readiness: `TypeOrmHealthIndicator.pingCheck('database', { timeout: 1500 })` + verificar migraciones pendientes
- **Archivo**: `apps/api/src/health/health.module.ts`
- Registrar en `AppModule`

### Paso 7: Tests backend (unit + E2E)
- **Unit**: `pagination-query.dto.spec.ts`, `pagination.spec.ts`, `audit.service.spec.ts`
- **E2E**: `audit-logs.e2e-spec.ts`, `requests-list.e2e-spec.ts`, `inventory-list.e2e-spec.ts`, `health.e2e-spec.ts`
- Verificar: límite 100, 400 en limit=101, paginación estable, aislamiento multi-tenant, inmutabilidad audit_logs (SQL directo), roles en `/audit-logs`, health endpoints

---

## PASOS DE FRONTEND

### Paso 8: Esquemas Zod + Tipos compartidos
- **Archivo**: `apps/web/src/lib/schemas/pagination.ts` — `paginationSchema`, `PaginatedResponse<T>`
- **Archivo**: `apps/web/src/lib/schemas/filters.ts` — `requestFiltersSchema`, `inventoryFiltersSchema`, `auditFiltersSchema`
- **Archivo**: `apps/web/src/lib/schemas/audit.ts` — `auditLogSchema`
- **Archivo**: `apps/web/src/features/dashboard/types.ts` — interfaces tipadas para UI

### Paso 9: Hooks TanStack Query para dashboard
- **Archivo**: `apps/web/src/features/dashboard/api.ts`
  - `useRequests(filters)` — `placeholderData: keepPreviousData`
  - `useInventory(filters)` — idem
  - `useAuditLogs(filters)` — idem
  - `useRequestHistory(requestId)` — idem

### Paso 10: Componentes de UI del dashboard
- **Archivo**: `apps/web/src/features/dashboard/request-filters.tsx` — react-hook-form + Zod, sincroniza con `useSearchParams`/`router.replace`, debounce 300ms en `search`
- **Archivo**: `apps/web/src/features/dashboard/requests-table.tsx` — tabla responsive (tarjetas en 390px), columnas: código, estado, prioridad, neededBy, solicitante, itemsCount, createdAt
- **Archivo**: `apps/web/src/features/dashboard/inventory-table.tsx` — SKU, nombre, físico, reservado, disponible; resaltar stock bajo
- **Archivo**: `apps/web/src/features/dashboard/audit-timeline.tsx` — línea de tiempo: acción legible, actor, fecha relativa, detalle expandible `before/after` (diff simple)
- **Archivo**: `apps/web/src/features/dashboard/pagination.tsx` — selector tamaño (10/20/50/100), prev/next, indicador "Mostrando X–Y de Z"

### Paso 11: Página del dashboard
- **Archivo**: `apps/web/src/app/(app)/dashboard/page.tsx`
  - Pestañas: Solicitudes, Inventario, Auditoría (visible solo COORDINADOR/AUDITOR)
  - Estado de pestaña en URL (`?tab=requests|inventory|audit`)
  - Skeletons, empty states, error con retry

### Paso 12: Tests frontend
- **Unit**: `request-filters.test.tsx` (filtros ↔ URL, debounce), `pagination.test.tsx`
- **Integración**: `dashboard.test.tsx` (visibilidad pestañas por rol, cambio página, estados vacío/error)

---

## ORDEN DE EJECUCIÓN Y VALIDACIÓN

| Paso | Qué hacer | Validación |
|------|-----------|------------|
| 1 | Migración + entidad `AuditLog` | `npm run migration:run` ✓, entidad compila |
| 2 | `PaginationQueryDto` + `paginate` helper | Tests unitarios pasan |
| 3 | `AuditModule` completo | Tests unitarios + E2E `/audit-logs` |
| 4 | Endpoints `/requests`, `/inventory`, `/requests/:id/history` | E2E: filtros, paginación, roles, multi-tenant |
| 5 | Integración `AuditService.record` en SPEC-1/2/3 | E2E: cada escritura genera log, rollback no deja log |
| 6 | `HealthModule` | E2E: `/health` 200, `/ready` 200/503 según BD |
| 7 | Tests backend completos | `npm run test:e2e` todo verde |
| 8-9 | Esquemas + hooks frontend | TypeScript compila, tipos correctos |
| 10-11 | Componentes + página dashboard | `npm run build` web OK, visual check responsive |
| 12 | Tests frontend | `npm run test` web OK |

---

## CRITERIOS DE ACEPTACIÓN (checklist final)

- [ ] Ningún endpoint de listado devuelve más de 100 elementos (`limit=101` → 400)
- [ ] `audit_logs` es inmutable por trigger y por diseño (sin endpoints escritura, sin `@UpdateDateColumn`)
- [ ] Todas las escrituras de SPEC-1/2/3 quedan auditadas dentro de su misma transacción
- [ ] El tablero filtra solicitudes, muestra existencias e historial con paginación del servidor
- [ ] `/health` y `/ready` funcionan y distinguen liveness de readiness

---

## NOTAS TÉCNICAS IMPORTANTES

1. **Multi-tenant**: `organizationId` SIEMPRE sale de `request.user.organizationId` (sesión), nunca del cliente
2. **Auditoría**: NUNCA guardar passwords, tokens, hashes en `before`/`after` — sanitizar en `AuditService.record`
3. **Orden determinista**: `paginate` siempre añade `.orderBy('entity.id', 'ASC')` como tie-breaker
4. **Whitelist sortBy**: Validar en DTO con `@IsIn([...permitted])`, nunca concatenar en SQL
5. **Triggers**: Incluir en migración TypeORM (no SQL suelto) para que sean versionados
6. **Sincronización URL**: Frontend usa `useSearchParams` + `router.replace` para no añadir historial innecesario
7. **TanStack Query**: `placeholderData: keepPreviousData` evita parpadeo al cambiar página/filtros