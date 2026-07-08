// types/service-lane.ts
export type ServiceLaneStatus = 'open' | 'in_progress' | 'blocked' | 'done' | 'closed';

export interface ServiceLaneJob {
  id: string;
  roNumber: string;
  title: string;
  status: ServiceLaneStatus;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  customerName: string;
  vehicle?: { year?: number; make?: string; model?: string; licensePlate?: string };
  technician?: { id: string; name: string; avatarUrl?: string };
  estimatedMinutes?: number;
  bay?: string;
  notes?: string;
}

export interface ServiceLane {
  id: string;
  name: string;
  jobs: ServiceLaneJob[];
  capacity?: number;
}