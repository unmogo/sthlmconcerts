// Lovable AI Gateway helper. Uses LOVABLE_API_KEY (preset).
const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const KEY = Deno.env.get("LOVABLE_API_KEY") ?? "";

export type AiUsage = { calls: number };

export class AiClient {
  usage: AiUsage = { calls: 0 };

  async json<T>(opts: {
    system: string;
    user: string;
    schema: Record<string, unknown>;
    name?: string;
    model?: string;
  }): Promise<T> {
    if (!KEY) throw new Error("LOVABLE_API_KEY missing");
    this.usage.calls++;

    const body = {
      model: opts.model ?? "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: opts.name ?? "extract",
            description: "Return the requested structured data",
            parameters: opts.schema,
          },
        },
      ],
      tool_choice: { type: "function", function: { name: opts.name ?? "extract" } },
    };

    let lastErr = "";
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await fetch(GATEWAY, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (res.status === 429 || res.status === 503) {
        const wait = 1500 * Math.pow(2, attempt) + Math.random() * 1000;
        await new Promise((r) => setTimeout(r, wait));
        lastErr = `${res.status}`;
        continue;
      }
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`AI ${res.status}: ${t.slice(0, 200)}`);
      }
      const data = await res.json();
      const args = data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
      if (!args) throw new Error("AI: no tool call returned");
      try {
        return JSON.parse(args) as T;
      } catch {
        throw new Error("AI: bad JSON");
      }
    }
    throw new Error(`AI rate-limited after retries (${lastErr})`);
  }
}

// Common schema for an event
export const EVENT_DRAFT_SCHEMA = {
  type: "object",
  properties: {
    events: {
      type: "array",
      items: {
        type: "object",
        properties: {
          artist: { type: "string", description: "Performer / show name" },
          venue_raw: { type: "string", description: "Venue name as printed on the page; empty if unknown" },
          address_raw: { type: "string", description: "Street address if visible; empty otherwise" },
          date_iso: { type: "string", description: "ISO 8601 datetime in Europe/Stockholm; empty if unknown" },
          ticket_url: { type: "string", description: "Direct ticket vendor URL if visible; empty otherwise" },
          source_url: { type: "string", description: "Detail page URL on the source site" },
          image_url: { type: "string", description: "Poster image URL if visible" },
          description: { type: "string", description: "Short 1-3 sentence event blurb from the page (no marketing fluff); empty if none" },
          event_type: { type: "string", enum: ["concert", "comedy", "other"] },
        },
        required: ["artist", "event_type", "source_url"],
        additionalProperties: false,
      },
    },
  },
  required: ["events"],
  additionalProperties: false,
} as const;

export type EventDraft = {
  artist: string;
  venue_raw?: string;
  address_raw?: string;
  date_iso?: string;
  ticket_url?: string;
  source_url: string;
  image_url?: string;
  description?: string;
  event_type: "concert" | "comedy" | "other";
};
