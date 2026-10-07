import { RequestStatus } from './request-status.enum.js';

/**
 * Máquina de estados centralizada para solicitudes.
 * Única fuente de verdad para transiciones permitidas.
 */
export const ALLOWED_TRANSITIONS: ReadonlyMap<RequestStatus, readonly RequestStatus[]> = new Map<
  RequestStatus,
  readonly RequestStatus[]
>([
  [RequestStatus.BORRADOR, [RequestStatus.ENVIADA, RequestStatus.CANCELADA]],
  [RequestStatus.ENVIADA, [RequestStatus.RESERVADA, RequestStatus.CANCELADA]],
  [RequestStatus.RESERVADA, [RequestStatus.DESPACHADA, RequestStatus.CANCELADA]],
  [RequestStatus.DESPACHADA, [RequestStatus.ENTREGADA]],
  [RequestStatus.ENTREGADA, []],
  [RequestStatus.CANCELADA, []],
]);

/**
 * Verifica si una transición de estado es válida según la máquina de estados.
 * @param from Estado actual
 * @param to Estado destino
 * @returns true si la transición está permitida
 */
export function canTransition(from: RequestStatus, to: RequestStatus): boolean {
  const allowed = ALLOWED_TRANSITIONS.get(from);
  return allowed ? allowed.includes(to) : false;
}

/**
 * Obtiene las transiciones permitidas desde un estado dado.
 * @param from Estado actual
 * @returns Array de estados destino permitidos
 */
export function getAllowedTransitions(from: RequestStatus): readonly RequestStatus[] {
  return ALLOWED_TRANSITIONS.get(from) ?? [];
}

/**
 * Verifica si un estado es terminal (no permite más transiciones).
 * @param status Estado a verificar
 * @returns true si es terminal
 */
export function isTerminalState(status: RequestStatus): boolean {
  const allowed = ALLOWED_TRANSITIONS.get(status);
  return allowed ? allowed.length === 0 : true;
}

/**
 * Verifica si un estado permite cancelación y qué efecto tiene sobre stock.
 * @param status Estado actual
 * @returns Objeto con { canCancel: boolean, releasesStock: boolean }
 */
export function getCancelEffect(status: RequestStatus): { canCancel: boolean; releasesStock: boolean } {
  switch (status) {
    case RequestStatus.BORRADOR:
    case RequestStatus.ENVIADA:
      return { canCancel: true, releasesStock: false };
    case RequestStatus.RESERVADA:
      return { canCancel: true, releasesStock: true };
    case RequestStatus.DESPACHADA:
    case RequestStatus.ENTREGADA:
    case RequestStatus.CANCELADA:
      return { canCancel: false, releasesStock: false };
    default:
      return { canCancel: false, releasesStock: false };
  }
}