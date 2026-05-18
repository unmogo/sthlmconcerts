import { useParams, Link, useNavigate } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Concert } from "@/types/concert";
import { format, isFuture } from "date-fns";
import { ArrowLeft, Calendar, MapPin, Ticket, ExternalLink, CalendarPlus, Clock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getDisplayImageUrl, getTicketLink, parseLocalDate } from "@/lib/utils/concert-utils";
import { eventCanonicalUrl, googleCalendarUrl } from "@/lib/event-links";
import { ShareButtons } from "@/components/ShareButtons";
import { Header } from "@/components/Header";
import { useState } from "react";
import type { FilterType } from "@/types/concert";

async function fetchConcertBySlug(slug: string): Promise<Concert | null> {
  // Try slug match first
  const { data: bySlug } = await supabase
    .from("concerts")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  if (bySlug) return bySlug as Concert;
  // Fallback: id match (handles legacy links)
  const looksLikeUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slug);
  if (!looksLikeUuid) return null;
  const { data: byId } = await supabase
    .from("concerts")
    .select("*")
    .eq("id", slug)
    .maybeSingle();
  return (byId as Concert) ?? null;
}

export default function EventDetail() {
  const { slug = "" } = useParams<{ slug: string }>();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<FilterType>("all");
  const { data: concert, isLoading } = useQuery({
    queryKey: ["concert", slug],
    queryFn: () => fetchConcertBySlug(slug),
    enabled: !!slug,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (!concert) {
    return (
      <div className="min-h-screen bg-background">
        <Helmet>
          <title>{t("event.notFound")} | STHLM Events</title>
          <meta name="robots" content="noindex" />
        </Helmet>
        <div className="container py-24 text-center">
          <h1 className="text-3xl font-bold text-foreground">{t("event.notFound")}</h1>
          <p className="mt-2 text-muted-foreground">{t("event.notFoundDesc")}</p>
          <Link to="/" className="mt-6 inline-block rounded-lg bg-gradient-neon px-4 py-2 text-sm font-bold text-primary-foreground">
            {t("event.browseAll")}
          </Link>
        </div>
      </div>
    );
  }

  const date = parseLocalDate(concert.date);
  const saleDate = concert.ticket_sale_date ? parseLocalDate(concert.ticket_sale_date) : null;
  const saleNotStarted = saleDate && isFuture(saleDate);
  const ticketUrl = getTicketLink(concert.ticket_url, concert.source_url);
  const image = getDisplayImageUrl(concert.image_url);
  const canonical = eventCanonicalUrl(concert);
  const dateFmt = format(date, "EEEE d MMMM yyyy 'at' HH:mm");
  const title = `${concert.artist} — ${concert.venue}, ${format(date, "d MMM yyyy")} | STHLM Events`;
  const description = concert.description?.trim() || `${concert.artist} live at ${concert.venue} in Stockholm on ${format(date, "EEEE d MMMM yyyy")}. ${concert.event_type === "comedy" ? "Comedy show" : "Concert"}. Find tickets and details on STHLM Events.`;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": concert.event_type === "comedy" ? "ComedyEvent" : "MusicEvent",
    name: `${concert.artist} — ${concert.venue}`,
    startDate: date.toISOString(),
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    location: {
      "@type": "Place",
      name: concert.venue,
      address: {
        "@type": "PostalAddress",
        addressLocality: "Stockholm",
        addressCountry: "SE",
      },
    },
    performer: { "@type": "PerformingGroup", name: concert.artist },
    image: image ? [image] : undefined,
    url: canonical,
    offers: ticketUrl
      ? {
          "@type": "Offer",
          url: ticketUrl,
          availability: concert.tickets_available
            ? "https://schema.org/InStock"
            : "https://schema.org/PreOrder",
        }
      : undefined,
  };

  return (
    <div className="min-h-screen bg-background">
      <Helmet>
        <html lang={i18n.language?.startsWith("sv") ? "sv" : "en"} />
        <title>{title}</title>
        <meta name="description" content={description} />
        <link rel="canonical" href={canonical} />
        <meta property="og:type" content="event" />
        <meta property="og:title" content={`${concert.artist} — ${concert.venue}`} />
        <meta property="og:description" content={description} />
        <meta property="og:url" content={canonical} />
        {image && <meta property="og:image" content={image} />}
        <meta name="twitter:card" content="summary_large_image" />
        {image && <meta name="twitter:image" content={image} />}
        <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
      </Helmet>

      <Header
        selectedIds={[]}
        onDelete={() => {}}
        onExport={() => {}}
        onAdd={() => {}}
        deleting={false}
        filter={filter}
        onFilterChange={(f) => {
          setFilter(f);
          navigate("/");
        }}
      />

      <main className="container py-8">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("event.back")}
        </Link>

        <article className="grid gap-8 lg:grid-cols-[1fr_1fr]">
          <div className="overflow-hidden rounded-2xl border border-border bg-gradient-card">
            {image ? (
              <img
                src={image}
                alt={concert.artist}
                className="aspect-[4/3] w-full object-cover"
                loading="eager"
              />
            ) : (
              <div className="aspect-[4/3] w-full flex items-center justify-center bg-gradient-neon">
                <span className="text-9xl font-bold text-primary-foreground/80">
                  {concert.artist.charAt(0)}
                </span>
              </div>
            )}
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-primary mb-2">
              {concert.event_type === "comedy" ? t("filters.comedy") : t("filters.concerts")}
            </p>
            <h1 className="text-4xl lg:text-5xl font-bold text-foreground leading-tight mb-4">
              {concert.artist}
            </h1>

            <div className="space-y-3 mb-6 text-foreground">
              <div className="flex items-center gap-2">
                <MapPin className="h-5 w-5 text-primary" />
                <span className="text-lg">{concert.venue}, Stockholm</span>
              </div>
              <div className="flex items-center gap-2">
                <Calendar className="h-5 w-5 text-accent" />
                <span className="text-lg">{dateFmt}</span>
              </div>
              {saleNotStarted && saleDate && (
                <div className="flex items-center gap-2 rounded-md border border-accent/20 bg-accent/5 px-3 py-2">
                  <Clock className="h-4 w-4 text-accent" />
                  <span className="text-sm text-accent font-medium">
                    {t("card.ticketsOnSale")} {format(saleDate, "d MMM yyyy")}
                  </span>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-3 mb-6">
              {ticketUrl ? (
                <a
                  href={ticketUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-neon px-5 py-3 text-base font-bold text-primary-foreground transition-opacity hover:opacity-90"
                >
                  <Ticket className="h-5 w-5" />
                  {t("event.getTickets")}
                  <ExternalLink className="h-4 w-4" />
                </a>
              ) : (
                <button
                  disabled
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-muted/40 px-5 py-3 text-base font-bold text-muted-foreground"
                >
                  <Ticket className="h-5 w-5" />
                  {t("card.ticketsTba")}
                </button>
              )}
              <a
                href={googleCalendarUrl(concert)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-card px-5 py-3 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
              >
                <CalendarPlus className="h-4 w-4" />
                {t("event.addToCalendar")}
              </a>
            </div>

            {concert.description && (
              <div className="mb-6 rounded-lg border border-border bg-card/40 p-4">
                <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                  {concert.description}
                </p>
              </div>
            )}

            <ShareButtons title={`${concert.artist} — ${concert.venue}`} url={canonical} />
          </div>
        </article>
      </main>
    </div>
  );
}
