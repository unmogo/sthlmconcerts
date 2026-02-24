# Process: Edge Functions

## Functions

| Function | Purpose | Auth Required |
|----------|---------|---------------|
| `scrape-concerts` | Multi-batch scraper with auto-chaining | Service role |
| `fetch-images` | MusicBrainz/Wikipedia artist image lookup | Service role |
| `manage-concerts` | CRUD + scrape-url for admin operations | Admin role |

## Patterns

### Error Handling
```typescript
// Always use { data, error } pattern — Supabase SDK does NOT return Promises with .catch()
const { data, error } = await supabase.from("table").upsert(row);
if (error) console.error("Context:", error.message);
```

### CORS Headers
All functions must include:
```typescript
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
```

### Response Format
```typescript
return new Response(JSON.stringify({ success: true, message: "..." }), {
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});
```

## Deployment
- Edge functions deploy automatically when code is saved
- After editing, verify with `supabase--edge-function-logs`
- Test with `supabase--curl_edge_functions`

## Common Pitfalls
- ❌ `.catch()` on Supabase queries — use `{ error }` destructuring
- ❌ `fetch()` without timeout — external APIs can hang; use `AbortController`
- ❌ Forgetting CORS preflight — always handle `OPTIONS` method
- ❌ Hardcoded secrets — use `Deno.env.get()` for all keys
