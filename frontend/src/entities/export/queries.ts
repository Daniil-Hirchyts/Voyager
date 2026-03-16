import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { submitExport, getExport } from './api';
import type { ExportFormat } from '@/shared/api/types';

export const exportKeys = {
  list: (tripId: string) => ['exports', tripId] as const,
  detail: (exportId: string) => ['export', exportId] as const,
};

export function useExport(exportId: string | null) {
  return useQuery({
    queryKey: exportKeys.detail(exportId ?? '__none__'),
    queryFn: () => getExport(exportId!),
    enabled: !!exportId,
    staleTime: 5_000,
    refetchInterval: (query) => {
      const status = (query.state.data as { status?: string } | undefined)?.status;
      if (status === 'SUCCEEDED' || status === 'FAILED' || status === 'EXPIRED') return false;
      return 2_000;
    },
  });
}

export function useSubmitExport(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      format,
      tripVersion,
      idempotencyKey,
    }: {
      format: ExportFormat;
      tripVersion: number;
      idempotencyKey: string;
    }) => submitExport(tripId, format, tripVersion, idempotencyKey),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: exportKeys.list(tripId) });
    },
  });
}
