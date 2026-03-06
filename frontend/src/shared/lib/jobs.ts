import type { Job } from '@/shared/api/types'

export const JOB_STATUS = {
  pending: 'PENDING',
  running: 'RUNNING',
  succeeded: 'SUCCEEDED',
  failed: 'FAILED',
} as const

export function isJobTerminal(status: string | null | undefined) {
  return status === JOB_STATUS.succeeded || status === JOB_STATUS.failed
}

export function isJobRunning(status: string | null | undefined) {
  return status === JOB_STATUS.pending || status === JOB_STATUS.running
}

export function isJobSuccessful(status: string | null | undefined) {
  return status === JOB_STATUS.succeeded
}

export function getJobResultErrors(job: Job | null | undefined) {
  const errors = job?.result && 'errors' in job.result ? job.result.errors : undefined
  return Array.isArray(errors) ? errors : []
}
