# SPEC-1: Autenticación y Permisos

> **Stack:** NestJS + TypeORM + PostgreSQL + class-validator / class-transformer (backend) · Next.js (App Router) + Zod + react-hook-form (frontend)
> **Dependencias:** ninguna (es la base de todas las demás specs)

## 1. Objetivo

Implementar autenticación basada en sesión con cookies HttpOnly, control de acceso por roles (RBAC) y **aislamiento multi-tenant estricto** entre organizaciones.

## 2. Convenciones del monorepo (aplican a las 5 specs)

```
/
├── apps/
│   ├── api/   # NestJS
│   └── web/   # Next.js
└── specs/     # estas specs
```

- Backend: NestJS, TypeORM (PostgreSQL), `class-validator`, `class-transformer`, `cookie-parser`, `argon2` para hashes, `@nestjs/config`, `@nestjs/swagger` (opcional).
- `ValidationPipe` global con `{ whitelist: true, forbidNonWhitelisted: true, transform: true }`.
- Todas las tablas de negocio llevan `organization_id` (UUID, NOT NULL, indexado).
- Los IDs son UUID v4. Fechas en `timestamptz` (UTC).
- Errores con formato uniforme: `{ statusCode, code, message, details? }` mediante un `HttpExceptionFilter` global.
- Migraciones TypeORM (`synchronize: false` siempre). Seeds en un script aparte (`npm run seed`).
- Frontend: Next.js App Router, TypeScript estricto, Zod para esquemas, `react-hook-form` + `@hookform/resolvers/zod`, TanStack Query para datos del servidor.

## 3. Modelo de datos

### `organizations`
| Columna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| code | varchar(20) UNIQUE | `ORG-A`, `ORG-B` |
| name | varchar(120) | |
| created_at | timestamptz | |

### `users`
| Columna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid FK → organizations | NOT NULL, índice |
| email | varchar(160) | UNIQUE por `(organization_id, email)` |
| password_hash | varchar | argon2id, nunca se devuelve en respuestas |
| full_name | varchar(120) | |
| role | enum `Role` | `SOLICITANTE`, `COORDINADOR`, `BODEGA`, `AUDITOR` |
| is_active | boolean | default true |
| created_at / updated_at | timestamptz | |

### `sessions`
| Columna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK → users | |
| organization_id | uuid | desnormalizado para consultas rápidas |
| token_hash | char(64) UNIQUE | SHA-256 del token opaco; el token en claro solo vive en la cookie |
| expires_at | timestamptz | TTL por defecto 8 h (`SESSION_TTL_HOURS`) |
| revoked_at | timestamptz NULL | se llena en logout |
| created_at | timestamptz | |

## 4. Roles y matriz de permisos

| Acción | SOLICITANTE | COORDINADOR | BODEGA | AUDITOR |
|---|:-:|:-:|:-:|:-:|
| Crear/editar borrador propio y enviarlo | ✅ | ❌ | ❌ | ❌ |
| Ver solicitudes | solo las propias | todas (su org) | todas (su org) | todas (su org) |
| Reservar stock | ❌ | ✅ | ❌ | ❌ |
| Despachar | ❌ | ❌ | ✅ | ❌ |
| Marcar entregada | ❌ | ✅ | ✅ | ❌ |
| Cancelar | propias en BORRADOR/ENVIADA | ✅ | ❌ | ❌ |
| Ver inventario | ✅ | ✅ | ✅ | ✅ |
| Ver auditoría | ❌ | ✅ | ❌ | ✅ |
| Usar resumen IA | ❌ | ✅ | ❌ | ❌ |

> Esta matriz es la fuente de verdad. Cada spec posterior la referencia con el decorador `@Roles(...)`.

## 5. Datos de prueba (seed)

2 organizaciones × 4 roles = **8 usuarios**. Contraseña de desarrollo tomada de `SEED_DEFAULT_PASSWORD` (.env), nunca hardcodeada en el código.

| Org | Email | Rol |
|---|---|---|
| ORG-A | solicitante@org-a.test | SOLICITANTE |
| ORG-A | coordinador@org-a.test | COORDINADOR |
| ORG-A | bodega@org-a.test | BODEGA |
| ORG-A | auditor@org-a.test | AUDITOR |
| ORG-B | solicitante@org-b.test | SOLICITANTE |
| ORG-B | coordinador@org-b.test | COORDINADOR |
| ORG-B | bodega@org-b.test | BODEGA |
| ORG-B | auditor@org-b.test | AUDITOR |

El seed debe ser **idempotente** (re-ejecutarlo no duplica datos).

## 6. Backend

### 6.1 Módulos y estructura

```
apps/api/src/
├── common/
│   ├── decorators/   # @Roles(), @CurrentUser(), @Public()
│   ├── filters/      # HttpExceptionFilter
│   ├── guards/       # SessionAuthGuard, RolesGuard
│   └── tenant/       # utilidades de aislamiento multi-tenant
├── auth/             # AuthController, AuthService, SessionService, dto/
├── organizations/    # entity
├── users/            # entity, UsersService
└── database/         # data-source, migrations, seeds
```

### 6.2 Endpoints

| Método | Ruta | Acceso | Descripción |
|---|---|---|---|
| POST | `/auth/login` | público | Valida credenciales, crea sesión y setea cookie |
| POST | `/auth/logout` | autenticado | Revoca la sesión y borra la cookie |
| GET | `/auth/me` | autenticado | Devuelve `{ id, email, fullName, role, organization: { id, code, name } }` |

**`LoginDto`** (class-validator):
```ts
export class LoginDto {
  @IsEmail() @MaxLength(160) email: string;
  @IsString() @MinLength(8) @MaxLength(128) password: string;
}
```

### 6.3 Cookie de sesión

- Nombre: `sid`.
- Opciones: `httpOnly: true`, `secure: NODE_ENV === 'production'`, `sameSite: 'lax'`, `path: '/'`, `maxAge` = TTL de sesión.
- Token: 32 bytes aleatorios (`crypto.randomBytes`), en base64url. En BD solo se guarda su SHA-256.
- Login fallido → `401` con mensaje genérico (`INVALID_CREDENTIALS`), sin revelar si el email existe. Usuario inactivo → mismo `401`.
- Rate limit básico en `/auth/login` con `@nestjs/throttler` (p. ej. 10 intentos/min por IP).
- CORS: `origin` = `WEB_ORIGIN`, `credentials: true`.

### 6.4 Guards y decoradores

- `SessionAuthGuard` (global, con `@Public()` para excepciones): lee la cookie `sid`, busca la sesión por hash, valida que no esté expirada ni revocada y que el usuario siga activo; adjunta `request.user = { id, organizationId, role }`.
- `RolesGuard` + `@Roles(Role.COORDINADOR, ...)`: 403 si el rol no está permitido.
- `@CurrentUser()`: param decorator que devuelve `request.user`.

### 6.5 Aislamiento multi-tenant (requisito crítico)

1. El `organizationId` **siempre** sale de la sesión, **nunca** del body, query o params.
2. Toda consulta a una entidad de negocio filtra por `organization_id`. Crear un helper/base service (`TenantScopedService`) que reciba el `organizationId` y lo aplique a `find`, `findOne`, `update`, `delete`.
3. Acceder a un recurso de otra organización responde **`404 Not Found`** (no 403), para no filtrar su existencia.
4. Los DTOs de entrada usan `whitelist`, por lo que cualquier `organizationId` enviado por el cliente es rechazado.
5. Las FKs compuestas o validaciones en servicio deben garantizar que, por ejemplo, un SKU o solicitud referenciado pertenezca a la misma organización.

## 7. Frontend (Next.js)

```
apps/web/src/
├── app/
│   ├── login/page.tsx
│   └── (app)/layout.tsx        # layout protegido
├── lib/
│   ├── api.ts                  # fetch wrapper con credentials: 'include'
│   └── schemas/auth.ts         # Zod
├── features/auth/
│   ├── login-form.tsx
│   └── auth-provider.tsx       # contexto con usuario actual (GET /auth/me)
└── middleware.ts               # redirige a /login si no hay cookie sid
```

- **Esquema Zod:** `loginSchema = z.object({ email: z.string().email(), password: z.string().min(8) })`.
- **Formulario:** `useForm({ resolver: zodResolver(loginSchema) })`, errores por campo, botón deshabilitado mientras envía, mensaje genérico si el backend responde 401.
- `api.ts` envía siempre `credentials: 'include'`; ante un `401` redirige a `/login`.
- Menú/acciones del UI se muestran u ocultan según `user.role` (solo UX; la seguridad real vive en el backend).
- Logout: llama `POST /auth/logout` y limpia el cache de TanStack Query.

## 8. Pruebas requeridas

**Unitarias:** hash/verificación de password, generación y hash de token de sesión, `RolesGuard`.

**E2E (Jest + Supertest, BD de test):**
- Login correcto devuelve cookie `HttpOnly` y `GET /auth/me` funciona.
- Login con password incorrecta o usuario inexistente → 401 con el mismo mensaje.
- Sesión expirada o revocada → 401.
- Tras logout, la misma cookie ya no sirve.
- Un usuario de `ORG-A` **no puede leer ni modificar** recursos de `ORG-B` (404) — probar con al menos un recurso de cada spec posterior cuando existan.
- Rol sin permiso → 403.

## 9. Criterios de aceptación

- [ ] Existen 2 organizaciones, 4 roles y 8 usuarios tras `npm run seed`.
- [ ] Login/logout/me funcionan con cookie HttpOnly; el token nunca aparece en el body ni en `localStorage`.
- [ ] Ningún endpoint de negocio acepta `organizationId` del cliente.
- [ ] Los tests E2E de aislamiento multi-tenant pasan.
- [ ] La página `/login` valida con Zod y maneja errores del servidor.

## 10. Fuera de alcance

Registro de usuarios, recuperación de contraseña, OAuth, MFA, refresh tokens.