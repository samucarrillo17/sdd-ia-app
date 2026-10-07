# SPEC-2: Creación de Solicitudes

> **Stack:** NestJS + TypeORM + class-validator (backend) · Next.js + Zod + react-hook-form (frontend)
> **Dependencias:** SPEC-1 (sesión, roles, multi-tenant)

## 1. Objetivo

Permitir que un `SOLICITANTE` cree un **borrador de solicitud** con entre **1 y 10 productos (SKUs)**, lo edite y lo **envíe**. Incluye un formulario adaptativo (móvil 390px / PC 1366px) navegable con teclado.

## 2. Modelo de datos

### `products` (catálogo de SKUs)
| Columna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid | índice |
| sku | varchar(40) | UNIQUE por `(organization_id, sku)` |
| name | varchar(160) | |
| unit | varchar(20) | `und`, `caja`, etc. |
| is_active | boolean | default true |

> El inventario (existencias) se modela en SPEC-3. Aquí solo se necesita el catálogo.

### `requests`
| Columna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid | índice |
| code | varchar(20) | legible, único por org (p. ej. `SOL-000123`, generado con secuencia) |
| requester_id | uuid FK → users | |
| status | enum `RequestStatus` | `BORRADOR`, `ENVIADA`, `RESERVADA`, `DESPACHADA`, `ENTREGADA`, `CANCELADA`. Default `BORRADOR` |
| priority | enum `Priority` | `ALTA`, `MEDIA`, `BAJA`. Default `MEDIA` |
| needed_by | date | fecha en que se necesita; debe ser ≥ hoy |
| notes | varchar(500) NULL | |
| submitted_at | timestamptz NULL | |
| created_at / updated_at | timestamptz | |

Índices: `(organization_id, status)`, `(organization_id, requester_id)`, `(organization_id, created_at DESC)`.

### `request_items`
| Columna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| request_id | uuid FK → requests ON DELETE CASCADE | |
| product_id | uuid FK → products | |
| quantity | int | CHECK `quantity > 0` |

UNIQUE `(request_id, product_id)` — no se repite un SKU dentro de la misma solicitud.

## 3. Reglas de negocio

1. Solo el rol `SOLICITANTE` crea solicitudes; solo puede ver/editar **las suyas**.
2. Una solicitud debe tener **mínimo 1 y máximo 10 ítems**, sin SKUs repetidos. Cantidad entera entre 1 y 9999.
3. Los productos deben existir, estar activos y pertenecer a la **misma organización** del usuario.
4. Un borrador se puede editar y eliminar libremente. Una vez `ENVIADA` ya no es editable por el solicitante.
5. Enviar = transición `BORRADOR → ENVIADA` (valida otra vez las reglas 2 y 3, setea `submitted_at`). La máquina de estados completa se formaliza en SPEC-3; aquí solo se implementa esta transición.
6. Todas las operaciones de escritura registran auditoría (se conecta en SPEC-4).

## 4. Backend

### 4.1 Estructura

```
apps/api/src/
├── products/       # entity, ProductsController (GET /products para el selector), service
└── requests/
    ├── entities/   # request.entity.ts, request-item.entity.ts
    ├── dto/        # create-request.dto.ts, update-request.dto.ts, request-item.dto.ts
    ├── requests.controller.ts
    └── requests.service.ts
```

### 4.2 DTOs (class-validator + class-transformer)

```ts
export class RequestItemDto {
  @IsUUID() productId: string;
  @IsInt() @Min(1) @Max(9999) quantity: number;
}

export class CreateRequestDto {
  @IsEnum(Priority) priority: Priority;
  @IsDateString() neededBy: string;              // validar >= hoy en el servicio
  @IsOptional() @IsString() @MaxLength(500) notes?: string;

  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10)
  @ValidateNested({ each: true }) @Type(() => RequestItemDto)
  items: RequestItemDto[];
}
// UpdateRequestDto = misma forma (reemplaza ítems completos mientras sea BORRADOR)
```

Validación adicional en servicio: SKUs duplicados, `neededBy >= hoy`, productos válidos de la org.

### 4.3 Endpoints

| Método | Ruta | Roles | Descripción |
|---|---|---|---|
| GET | `/products?search=&page=&limit=` | todos | Catálogo activo de la org (paginado, máx 100) |
| POST | `/requests` | SOLICITANTE | Crea un borrador |
| GET | `/requests/:id` | SOLICITANTE (propia), COORDINADOR, BODEGA, AUDITOR | Detalle con ítems y producto |
| PUT | `/requests/:id` | SOLICITANTE | Edita borrador propio |
| DELETE | `/requests/:id` | SOLICITANTE | Elimina borrador propio |
| POST | `/requests/:id/submit` | SOLICITANTE | `BORRADOR → ENVIADA` |

Códigos: `201` al crear, `404` si no existe / es de otra org / no es del usuario (siendo solicitante), `409 INVALID_STATE` si el estado no permite la operación, `422`/`400` por validación.

> El listado `GET /requests` con filtros y paginación se implementa en SPEC-4.

### 4.4 Implementación

- `create` y `update` corren en **una transacción** (`dataSource.transaction`): se guarda la cabecera y se reemplazan los ítems.
- `submit` hace `SELECT ... FOR UPDATE` de la solicitud para evitar doble envío concurrente.
- Los DTOs de respuesta usan `class-transformer` (`@Expose`/`ClassSerializerInterceptor`) para no filtrar columnas internas.

## 5. Frontend (Next.js)

### 5.1 Estructura

```
apps/web/src/
├── app/(app)/requests/
│   ├── new/page.tsx
│   └── [id]/page.tsx            # detalle + edición del borrador
├── features/requests/
│   ├── request-form.tsx
│   ├── product-select.tsx       # combobox accesible con búsqueda
│   └── api.ts                   # hooks TanStack Query
└── lib/schemas/request.ts       # Zod
```

### 5.2 Esquema Zod (espejo del DTO)

```ts
export const requestItemSchema = z.object({
  productId: z.string().uuid('Selecciona un producto'),
  quantity: z.coerce.number().int().min(1).max(9999),
});

export const requestSchema = z.object({
  priority: z.enum(['ALTA', 'MEDIA', 'BAJA']),
  neededBy: z.string().refine(isTodayOrFuture, 'La fecha no puede ser pasada'),
  notes: z.string().max(500).optional(),
  items: z.array(requestItemSchema)
    .min(1, 'Agrega al menos 1 producto')
    .max(10, 'Máximo 10 productos')
    .refine(hasNoDuplicateProducts, 'Hay productos repetidos'),
});
export type RequestFormValues = z.infer<typeof requestSchema>;
```

### 5.3 Formulario

- `useForm<RequestFormValues>({ resolver: zodResolver(requestSchema), defaultValues })` + `useFieldArray({ name: 'items' })`.
- Botón "Agregar producto" deshabilitado al llegar a 10; botón "Quitar" deshabilitado cuando queda 1.
- Acciones: **Guardar borrador** (POST/PUT) y **Enviar** (guarda y luego `POST /requests/:id/submit`, con diálogo de confirmación).
- Mapear errores del backend (`details`) a `setError` por campo.
- Estados de carga, error y éxito (toast + redirección al detalle).

### 5.4 Diseño adaptativo

| Viewport | Layout |
|---|---|
| **390px (móvil)** | Una columna. Cada ítem es una tarjeta apilada (producto arriba, cantidad abajo, botón quitar). Botones de acción pegados abajo, ancho completo, área táctil ≥ 44px. |
| **1366px (PC)** | Formulario en dos columnas (datos generales a la izquierda, ítems en tabla editable a la derecha). Acciones alineadas a la derecha. |

- Mobile-first con Tailwind (`sm:`, `lg:`); sin scroll horizontal en ninguno de los dos anchos.
- Texto de inputs ≥ 16px en móvil (evita zoom automático en iOS).

### 5.5 Navegación por teclado y accesibilidad

- Orden de tabulación lógico; `Enter` en un campo no envía el formulario por accidente (solo el botón de enviar lo hace).
- El combobox de productos: flechas ↑/↓, `Enter` para elegir, `Esc` para cerrar (patrón WAI-ARIA combobox).
- Foco visible en todos los controles; al agregar un ítem el foco pasa a su selector de producto; al quitar, al botón "Agregar" o al ítem anterior.
- `label` asociado a cada input, `aria-invalid` + `aria-describedby` para errores; resumen de errores con `role="alert"`.

## 6. Pruebas requeridas

**Backend (unit + E2E):**
- Crear con 0 ítems → 400; con 11 ítems → 400; con SKU repetido → 400; con cantidad 0 → 400.
- Crear con producto de otra organización → 404/400 (no se acepta).
- Un solicitante no puede ver ni editar la solicitud de otro solicitante.
- Un usuario de ORG-B no puede ver una solicitud de ORG-A.
- `submit` dos veces seguidas → la segunda responde 409.
- Editar una solicitud `ENVIADA` → 409.

**Frontend (Vitest + Testing Library):**
- El esquema Zod rechaza 0 y 11 ítems y duplicados.
- Agregar/quitar ítems respeta los límites 1–10.
- Un test de teclado: completar y enviar el formulario usando solo `Tab`/`Enter`/flechas.
- (Opcional) Playwright con viewports 390×844 y 1366×768.

## 7. Criterios de aceptación

- [ ] Un solicitante crea, edita, elimina y envía solicitudes con 1–10 ítems.
- [ ] Las reglas se validan tanto en el cliente (Zod) como en el servidor (class-validator + servicio).
- [ ] El formulario es usable en 390px y 1366px y completamente operable con teclado.
- [ ] Ninguna solicitud es visible/modificable fuera de su organización o de su dueño (si es solicitante).