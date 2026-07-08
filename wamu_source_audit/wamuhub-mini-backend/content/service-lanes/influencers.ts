// content/service-lanes/influencers.ts
import type { ServiceLaneJob } from './types/service-lane';

export const influencers: ServiceLaneJob[] = [
  {
    id: 'job-1',
    roNumber: 'RO-1001',
    title: 'Oil change + inspection',
    status: 'in_progress',
    priority: 'medium',
    customerName: 'Ava Chen',
    vehicle: { year: 2021, make: 'Toyota', model: 'Camry', licensePlate: 'ABC123' },
    technician: { id: 'tech-1', name: 'Luis' },
    estimatedMinutes: 45,
    bay: 'Bay 2',
  },
];