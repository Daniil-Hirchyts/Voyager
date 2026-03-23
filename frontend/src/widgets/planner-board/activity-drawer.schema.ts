import { z } from 'zod';

export const activitySchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(300),
  description: z.string().optional(),
  start_time: z.string().optional(),
  duration_min: z
    .union([z.number().int().positive(), z.nan()])
    .optional()
    .transform((value) => (value == null || Number.isNaN(value) ? undefined : value)),
  estimated_cost_amount: z
    .union([z.number().nonnegative(), z.nan()])
    .optional()
    .transform((value) => (value == null || Number.isNaN(value) ? undefined : value)),
  estimated_cost_currency: z.string().optional(),
  notes: z.string().optional(),
  origin_text: z.string().optional(),
  destination_text: z.string().optional(),
  travel_mode: z.string().optional(),
  hotel_name: z.string().optional(),
  address_text: z.string().optional(),
  checkin_date: z.string().optional(),
  checkout_date: z.string().optional(),
  room_type: z.string().optional(),
});

export type ActivityFormValues = z.infer<typeof activitySchema>;
export type Step = 0 | 1 | 2;
export type CreateFlow = 'itinerary' | 'hotel' | 'travel';
export const INBOX_DAY_VALUE = '__inbox__';
