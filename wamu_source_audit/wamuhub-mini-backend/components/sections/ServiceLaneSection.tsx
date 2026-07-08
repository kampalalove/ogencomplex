// components/sections/ServiceLaneSection.tsx
import { influencers } from '../../content/service-lanes/influencers';
import { photographers } from '../../content/service-lanes/photographers';
import { weddingPlanners } from '../../content/service-lanes/weddingPlanners';
import type { ServiceLane, ServiceLaneJob } from '../../content/service-lanes/types/service-lane';

const lanes: ServiceLane[] = [
  { id: 'influencers', name: 'Influencers', jobs: influencers as ServiceLaneJob[] },
  { id: 'photographers', name: 'Photographers', jobs: photographers as ServiceLaneJob[] },
  { id: 'weddingPlanners', name: 'Wedding Planners', jobs: weddingPlanners as ServiceLaneJob[] },
];

export default function ServiceLaneSection() {
  if (lanes.every(l => l.jobs.length === 0)) {
    return <div className="p-4 text-sm text-gray-500">No service lane data yet.</div>;
  }

  return (
    <section className="grid gap-4 md:grid-cols-3">
      {lanes.map(lane => (
        <div key={lane.id} className="rounded-2xl border p-4 shadow-sm">
          <header className="mb-3 flex items-baseline justify-between">
            <h3 className="text-lg font-semibold">{lane.name}</h3>
            <span className="text-xs text-gray-500">{lane.jobs.length} jobs</span>
          </header>

          <ul className="space-y-2">
            {lane.jobs.map(job => (
              <li key={job.id} className="rounded-xl border p-3">
                <div className="flex items-center justify-between">
                  <p className="font-medium">{job.title}</p>
                  <span className="text-xs uppercase tracking-wide text-gray-500">{job.status}</span>
                </div>
                <p className="text-sm text-gray-600">{job.customerName} · RO #{job.roNumber}</p>
                {job.vehicle?.make && (
                  <p className="text-xs text-gray-500">
                    {[job.vehicle.year, job.vehicle.make, job.vehicle.model].filter(Boolean).join(' ')}
                  </p>
                )}
                {job.bay && <p className="text-xs text-gray-500">{job.bay}</p>}
              </li>
            ))}
            {lane.jobs.length === 0 && (
              <li className="text-sm text-gray-400">No jobs in this lane.</li>
            )}
          </ul>
        </div>
      ))}
    </section>
  );
}