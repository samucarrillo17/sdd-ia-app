# Specs del proyecto

Stack: **NestJS + TypeORM + class-validator** (backend) · **Next.js + Zod + react-hook-form** (frontend).

| Orden | Spec | Depende de |
|---|---|---|
| 1 | `SPEC-1-autenticacion-permisos.md` | — |
| 2 | `SPEC-2-creacion-solicitudes.md` | 1 |
| 3 | `SPEC-3-inventario-concurrencia.md` | 1, 2 |
| 4 | `SPEC-4-tablero-consultas-auditoria.md` | 1, 2, 3 |
| 5 | `SPEC-5-asistente-ia.md` | 1, 2, 3, 4 |

Implementar **en orden** y no pasar a la siguiente hasta que se cumplan los criterios de aceptación de la actual.
Convenciones comunes (monorepo, validación, errores, multi-tenant) están en la sección 2 de SPEC-1.