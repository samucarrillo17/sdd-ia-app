import { Priority } from '../../requests/enums/priority.enum.js';
import { RequestStatus } from '../../requests/enums/request-status.enum.js';

export interface FallbackRequest {
  id: string;
  code: string;
  priority: Priority;
  neededBy: Date;
  createdAt: Date;
  items: Array<{
    productId: string;
    quantity: number;
    available: number;
  }>;
  notes: string | null;
}

export interface FallbackRecommendation {
  requestId: string;
  rank: number;
  action: 'RESERVAR' | 'REVISAR' | 'POSTERGAR';
  reason: string;
}

export interface FallbackResult {
  summary: string;
  recommendations: FallbackRecommendation[];
}

function getPriorityOrder(priority: Priority): number {
  switch (priority) {
    case Priority.ALTA:
      return 1;
    case Priority.MEDIA:
      return 2;
    case Priority.BAJA:
      return 3;
    default:
      return 4;
  }
}

function daysUntil(targetDate: Date, now: Date): number {
  const target = new Date(targetDate);
  target.setHours(0, 0, 0, 0);
  const current = new Date(now);
  current.setHours(0, 0, 0, 0);
  const diffTime = target.getTime() - current.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

function hasStockAvailable(items: FallbackRequest['items']): boolean {
  return items.every(item => item.available >= item.quantity);
}

function hasMissingStock(items: FallbackRequest['items']): boolean {
  return items.some(item => item.available < item.quantity);
}

export function priorityFallback(requests: FallbackRequest[], now: Date = new Date()): FallbackResult {
  // 1. Ordenar por: prioridad → neededBy ASC → createdAt ASC → id ASC
  const sorted = [...requests].sort((a, b) => {
    const priorityDiff = getPriorityOrder(a.priority) - getPriorityOrder(b.priority);
    if (priorityDiff !== 0) return priorityDiff;

    const neededByDiff = a.neededBy.getTime() - b.neededBy.getTime();
    if (neededByDiff !== 0) return neededByDiff;

    const createdAtDiff = a.createdAt.getTime() - b.createdAt.getTime();
    if (createdAtDiff !== 0) return createdAtDiff;

    return a.id.localeCompare(b.id);
  });

  // 2. Asignar rank y action
  const recommendations: FallbackRecommendation[] = sorted.map((req, index) => {
    const rank = index + 1;
    const days = daysUntil(req.neededBy, now);
    let action: 'RESERVAR' | 'REVISAR' | 'POSTERGAR';
    let reason: string;

    if (req.priority === Priority.BAJA && days > 14) {
      action = 'POSTERGAR';
      reason = `Prioridad BAJA, necesaria en ${days} días.`;
    } else if (hasMissingStock(req.items)) {
      action = 'REVISAR';
      const missingItems = req.items.filter(item => item.available < item.quantity);
      if (missingItems.length === 1) {
        reason = `Prioridad ${req.priority}, faltante de stock en ${missingItems[0].productId}.`;
      } else {
        reason = `Prioridad ${req.priority}, faltante de stock en ${missingItems.length} productos.`;
      }
    } else {
      action = 'RESERVAR';
      reason = `Prioridad ${req.priority}, necesaria en ${days} días.`;
    }

    return { requestId: req.id, rank, action, reason };
  });

  // 3. Construir summary con plantilla fija
  const total = requests.length;
  const byPriority = {
    ALTA: requests.filter(r => r.priority === Priority.ALTA).length,
    MEDIA: requests.filter(r => r.priority === Priority.MEDIA).length,
    BAJA: requests.filter(r => r.priority === Priority.BAJA).length,
  };
  const dueSoon = requests.filter(r => daysUntil(r.neededBy, now) <= 3).length;
  const withMissingStock = requests.filter(r => hasMissingStock(r.items)).length;

  const summary = `Se analizaron ${total} solicitudes ENVIADA. ${byPriority.ALTA} ALTA, ${byPriority.MEDIA} MEDIA, ${byPriority.BAJA} BAJA. ${dueSoon} vencen en ≤3 días. ${withMissingStock} tienen faltante de stock.`;

  return { summary, recommendations };
}