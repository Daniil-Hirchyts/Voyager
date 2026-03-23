export type PlaceCandidate = {
  source: string;
  external_id?: string | null;
  saved_place_id?: string | null;
  name: string;
  category: string | null;
  address_text: string | null;
  lat: number | null;
  lon: number | null;
  metadata: Record<string, unknown>;
  description?: string | null;
};
