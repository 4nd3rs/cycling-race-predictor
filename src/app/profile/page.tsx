import { redirect } from "next/navigation";
import Link from "next/link";
import { Header } from "@/components/header";
import { Badge } from "@/components/ui/badge";
import { getAuthUser } from "@/lib/auth";
import { db, userFollows, userWhatsapp, riders, raceEvents, races, teams } from "@/lib/db";
import { eq, and, inArray } from "drizzle-orm";
import { getFlag } from "@/lib/country-flags";
import { WhatsAppGroupWidget } from "@/components/whatsapp-group-widget";


export default async function ProfilePage() {
  const user = await getAuthUser();
  if (!user) redirect("/sign-in");

  const [follows, whatsappRows] = await Promise.all([
    db.select().from(userFollows).where(eq(userFollows.userId, user.id)),
    db.select().from(userWhatsapp).where(eq(userWhatsapp.userId, user.id)).limit(1),
  ]);

  const whatsapp = whatsappRows[0] || null;

  const riderFollows = follows.filter((f) => f.followType === "rider");
  const raceFollows = follows.filter((f) => f.followType === "race_event");

  // Fetch rider details
  const riderDetails = await Promise.all(
    riderFollows.map(async (f) => {
      const [rider] = await db
        .select({ id: riders.id, name: riders.name, nationality: riders.nationality, photoUrl: riders.photoUrl })
        .from(riders)
        .where(eq(riders.id, f.entityId))
        .limit(1);
      return rider || null;
    })
  );

  // Fetch race event details
  const raceDetails = await Promise.all(
    raceFollows.map(async (f) => {
      const [event] = await db
        .select({ id: raceEvents.id, name: raceEvents.name, discipline: raceEvents.discipline, date: raceEvents.date, slug: raceEvents.slug })
        .from(raceEvents)
        .where(eq(raceEvents.id, f.entityId))
        .limit(1);
      return event || null;
    })
  );

  // Individual race category follows (follow_type = "race")
  const raceCatFollowIds = follows.filter((f) => f.followType === "race").map(f => f.entityId);
  const raceCatDetails = raceCatFollowIds.length > 0
    ? await db.select({
        id: races.id, gender: races.gender, ageCategory: races.ageCategory,
        discipline: races.discipline, categorySlug: races.categorySlug,
        eventId: races.raceEventId,
        eventName: raceEvents.name, eventSlug: raceEvents.slug, eventDate: raceEvents.date,
      })
      .from(races)
      .innerJoin(raceEvents, eq(races.raceEventId, raceEvents.id))
      .where(inArray(races.id, raceCatFollowIds))
      .limit(30)
    : [];

  const teamFollowIds = follows.filter((f) => f.followType === "team").map(f => f.entityId);
  const teamDetails = teamFollowIds.length > 0
    ? await db.select({ id: teams.id, name: teams.name, logoUrl: teams.logoUrl, country: teams.country, division: teams.division })
        .from(teams).where(inArray(teams.id, teamFollowIds)).limit(30)
    : [];

  const initials = (user.name || user.email || "U")
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-4xl py-8 space-y-8">

          {/* User header */}
          <div className="flex items-center gap-4">
            {user.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt={user.name || "Avatar"}
                className="w-16 h-16 rounded-full border border-border/50"
              />
            ) : (
              <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center text-xl font-bold text-primary">
                {initials}
              </div>
            )}
            <div>
              <h1 className="text-2xl font-black tracking-tight">{user.name || "User"}</h1>
              <p className="text-sm text-muted-foreground">{user.email}</p>
              <Badge variant="outline" className="mt-1 capitalize">{user.tier}</Badge>
            </div>
          </div>

          {/* Followed Riders */}
          <section>
            <h2 className="text-lg font-bold mb-3">Followed Riders</h2>
            {riderDetails.filter(Boolean).length > 0 ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {riderDetails.filter(Boolean).map((rider) => (
                  <Link
                    key={rider!.id}
                    href={`/riders/${rider!.id}`}
                    className="flex items-center gap-3 rounded-lg border border-border/50 bg-card/30 p-3 hover:bg-card/60 transition-colors"
                  >
                    {rider!.photoUrl ? (
                      <img
                        src={rider!.photoUrl}
                        alt={rider!.name}
                        className="w-10 h-10 rounded-full object-cover object-top border border-border/30"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-sm font-bold">
                        {rider!.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{rider!.name}</p>
                      {rider!.nationality && (
                        <p className="text-xs text-muted-foreground">{getFlag(rider!.nationality)} {rider!.nationality}</p>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground rounded-lg border border-border/50 bg-card/20 p-6 text-center">
                No followed riders yet.
              </p>
            )}
          </section>

          {/* Followed Races */}
          <section>
            <h2 className="text-lg font-bold mb-3">Followed Races</h2>
            {raceDetails.filter(Boolean).length > 0 ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {raceDetails.filter(Boolean).map((event) => (
                  <Link
                    key={event!.id}
                    href={`/races/${event!.discipline}/${event!.slug}`}
                    className="flex flex-col rounded-lg border border-border/50 bg-card/30 p-3 hover:bg-card/60 transition-colors"
                  >
                    <p className="text-sm font-medium truncate">{event!.name}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                      <span className="capitalize">{event!.discipline}</span>
                      <span>{event!.date}</span>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground rounded-lg border border-border/50 bg-card/20 p-6 text-center">
                No followed races yet.
              </p>
            )}
          </section>

          {/* Followed Race Categories */}
          {raceCatDetails.length > 0 && (
            <section>
              <h2 className="text-lg font-bold mb-3">Followed Race Categories</h2>
              <div className="grid gap-2 sm:grid-cols-2">
                {raceCatDetails.map((rc) => {
                  const g = rc.gender === "men" ? "M" : "F";
                  const age = rc.ageCategory === "elite" ? "" : rc.ageCategory === "u23" ? " U23" : rc.ageCategory === "junior" ? " Junior" : ` ${rc.ageCategory}`;
                  const label = `${g}${age}`;
                  const url = rc.eventSlug && rc.categorySlug
                    ? `/races/${rc.discipline}/${rc.eventSlug}/${rc.categorySlug}`
                    : `/races/${rc.discipline}/${rc.eventSlug}`;
                  return (
                    <Link key={rc.id} href={url}
                      className="flex items-center gap-3 rounded-lg border border-border/50 bg-card/30 p-3 hover:bg-card/60 transition-colors">
                      <span className="text-xs font-bold bg-primary/20 text-primary rounded px-2 py-0.5 shrink-0">{label}</span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{rc.eventName}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{rc.eventDate}</p>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </section>
          )}

          {/* Followed Teams */}
          <section>
            <h2 className="text-lg font-bold mb-3">Followed Teams</h2>
            {teamDetails.length > 0 ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {teamDetails.map((team) => (
                  <Link key={team.id} href={`/teams/${team.id}`}
                    className="flex items-center gap-3 rounded-lg border border-border/50 bg-card/30 p-3 hover:bg-card/60 transition-colors">
                    {team.logoUrl ? (
                      <img src={team.logoUrl} alt={team.name} className="h-8 w-8 object-contain shrink-0" />
                    ) : (
                      <span className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-xs font-bold shrink-0">
                        {team.name.slice(0, 2).toUpperCase()}
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{team.name}</p>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                        {team.country && <span>{getFlag(team.country)}</span>}
                        {team.division && <span className="font-mono">{team.division}</span>}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground rounded-lg border border-border/50 bg-card/20 p-6 text-center">No followed teams yet.</p>
            )}
          </section>

          {/* WhatsApp Group */}
          <section>
            <h2 className="text-lg font-bold mb-3">WhatsApp Notifications</h2>
            <WhatsAppGroupWidget initialPhone={whatsapp?.phoneNumber ?? null} initialFrequency={whatsapp?.notificationFrequency ?? "key-moments"} />
          </section>




        </div>
      </main>
    </div>
  );
}
