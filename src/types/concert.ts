export type EventType = "concert" | "comedy" | "other";

export interface Concert {
  id: string;
  artist: string;
  venue: string;
  date: string;
  ticket_url: string | null;
  ticket_sale_date: string | null;
  tickets_available: boolean;
  image_url: string | null;
  source: string | null;
  source_url: string | null;
  event_type: EventType;
  created_at: string;
  updated_at: string;
}
