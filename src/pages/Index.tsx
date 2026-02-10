import { Header } from "@/components/Header";
import { ConcertGrid } from "@/components/ConcertGrid";

const Index = () => {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container py-8">
        <div className="mb-8">
          <h2 className="text-3xl font-bold text-foreground">
            Upcoming <span className="text-gradient">Concerts</span>
          </h2>
          <p className="mt-2 text-muted-foreground">
            All upcoming concerts and events in Stockholm, sorted chronologically.
          </p>
        </div>
        <ConcertGrid />
      </main>
    </div>
  );
};

export default Index;
