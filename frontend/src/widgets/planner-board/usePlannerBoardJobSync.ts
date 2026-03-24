import { useEffect, type MutableRefObject } from 'react';
import { type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { plannerKeys } from '@/entities/planner/queries';
import { isJobSuccessful, isJobTerminal } from '@/shared/lib/jobs';
import { buildPlannerGenerationReport } from './planner-board.utils';

type PlannerJobData = {
  id: string;
  status: string;
  result: unknown;
  error: unknown;
  job_type: string;
} | null | undefined;

type UsePlannerBoardJobSyncOptions = {
  tripId: string;
  pendingJobId: string | null;
  job: PlannerJobData;
  queryClient: QueryClient;
  clearPendingJobId: (tripId: string) => void;
  setGenerationReport: (
    tripId: string,
    report: ReturnType<typeof buildPlannerGenerationReport>,
  ) => void;
  prevJobStatusRef: MutableRefObject<string | null>;
  mirroredAssistantJobIdsRef: MutableRefObject<Set<string>>;
};

export function usePlannerBoardJobSync({
  tripId,
  pendingJobId,
  job,
  queryClient,
  clearPendingJobId,
  setGenerationReport,
  prevJobStatusRef,
  mirroredAssistantJobIdsRef,
}: UsePlannerBoardJobSyncOptions) {
  useEffect(() => {
    if (!job || !pendingJobId) {
      return;
    }

    if (!isJobTerminal(job.status) || prevJobStatusRef.current === job.status) {
      return;
    }

    prevJobStatusRef.current = job.status;
    setGenerationReport(tripId, buildPlannerGenerationReport(job.id, job.status, job.result, job.error));

    const mirroredInAssistant = mirroredAssistantJobIdsRef.current.has(pendingJobId);
    mirroredAssistantJobIdsRef.current.delete(pendingJobId);

    if (isJobSuccessful(job.status)) {
      void queryClient.invalidateQueries({ queryKey: plannerKeys.detail(tripId) });
      clearPendingJobId(tripId);
      if (!mirroredInAssistant) {
        toast.success('Planner updated');
      }
      return;
    }

    clearPendingJobId(tripId);
    if (!mirroredInAssistant) {
      toast.error(
        job.job_type === 'itinerary.reset' ? 'Itinerary reset failed' : 'Planner generation failed',
      );
    }
  }, [
    clearPendingJobId,
    job,
    mirroredAssistantJobIdsRef,
    pendingJobId,
    prevJobStatusRef,
    queryClient,
    setGenerationReport,
    tripId,
  ]);
}
