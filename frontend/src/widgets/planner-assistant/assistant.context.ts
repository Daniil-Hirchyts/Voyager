import { createContext, useContext } from 'react';
import type { PlannerAssistantContextValue } from './assistant.types';

export const PlannerAssistantContext = createContext<PlannerAssistantContextValue | null>(null);

export function usePlannerAssistantContext() {
  const ctx = useContext(PlannerAssistantContext);
  if (!ctx) {
    throw new Error('PlannerAssistantContext not found');
  }
  return ctx;
}
