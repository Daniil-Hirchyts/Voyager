import { Link, useNavigate, useParams } from 'react-router-dom';
import { Link2, MapPinned, ShieldCheck, UserPlus, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { useAcceptTripInvitation, useTripInvitationPreview } from '@/entities/trip-sharing/queries';
import { isApiError } from '@/shared/api/client';
import { WorkspacePage } from '@/shared/layouts/workspace-shell';
import { VoyagerLoader } from '@/widgets/app-shell/logo';

const heroClassName =
  'rounded-[28px] border border-black/8 bg-[linear-gradient(145deg,rgba(250,244,238,0.92)_0%,rgba(255,255,255,0.98)_52%,rgba(240,247,255,0.92)_100%)] p-6 md:p-8';

function formatInviteDate(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value));
}

export default function TripInvitePage() {
  const navigate = useNavigate();
  const { token = '' } = useParams<{ token: string }>();
  const preview = useTripInvitationPreview(token);
  const acceptInvitation = useAcceptTripInvitation();

  async function handleAcceptInvite() {
    try {
      const trip = await acceptInvitation.mutateAsync(token);
      toast.success('Trip access granted');
      navigate(`/app/trips/${trip.id}/plan`, { replace: true });
    } catch (error) {
      toast.error(isApiError(error) ? error.message : 'Could not accept invite');
    }
  }

  const errorMessage =
    preview.error && isApiError(preview.error)
      ? preview.error.message
      : 'This invitation is not available anymore.';

  return (
    <WorkspacePage className="gap-5 pb-10 md:gap-6">
      <section className={heroClassName}>
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex max-w-2xl flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="accent">
                <UserPlus data-icon="inline-start" />
                Collaboration invite
              </Badge>
              <Badge variant="outline">
                <ShieldCheck data-icon="inline-start" />
                Authenticated access
              </Badge>
            </div>
            <div className="flex flex-col gap-2">
              <h1 className="text-[2rem] font-semibold tracking-[-0.06em] text-[var(--color-text)] md:text-[2.6rem]">
                Join a shared trip
              </h1>
              <p className="max-w-[42rem] text-sm leading-6 text-[var(--color-text-muted)] md:text-[0.98rem]">
                Accept this single-use invitation to collaborate on the same itinerary, assets, and
                map context as the rest of the trip team.
              </p>
            </div>
          </div>

          <div className="grid gap-2 rounded-[20px] border border-black/8 bg-white/74 px-4 py-4 text-sm text-[var(--color-text-muted)]">
            <span className="text-[0.72rem] font-semibold tracking-[0.14em] text-[var(--color-text-muted)] uppercase">
              How it works
            </span>
            <p>1. Review the invite details.</p>
            <p>2. Accept once while signed in.</p>
            <p>3. Open the shared planner immediately.</p>
          </div>
        </div>
      </section>

      <Card variant="elevated" className="overflow-hidden">
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">
              <Link2 data-icon="inline-start" />
              Single-use link
            </Badge>
            <Badge variant="outline">
              <Users data-icon="inline-start" />
              Shared editing
            </Badge>
          </div>
          <CardTitle>Invitation details</CardTitle>
          <CardDescription>
            Voyager only activates the link after you confirm the trip below.
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-5">
          {preview.isLoading ? (
            <div className="rounded-[22px] border border-dashed border-black/8 bg-[var(--color-secondary-surface)] px-5 py-8">
              <div className="flex items-center gap-3 text-sm text-[var(--color-text-muted)]">
                <VoyagerLoader className="size-4" />
                Loading invitation preview…
              </div>
            </div>
          ) : preview.data ? (
            <>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-[22px] border border-black/8 bg-[var(--color-secondary-surface)] px-5 py-5">
                  <p className="text-[0.72rem] font-semibold tracking-[0.14em] text-[var(--color-text-muted)] uppercase">
                    Trip
                  </p>
                  <h2 className="mt-3 text-[1.4rem] font-semibold tracking-[-0.04em] text-[var(--color-text)]">
                    {preview.data.trip_title}
                  </h2>
                  <p className="mt-2 flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
                    <MapPinned className="size-4" />
                    {preview.data.destination_text}
                  </p>
                </div>

                <div className="rounded-[22px] border border-black/8 bg-[var(--color-secondary-surface)] px-5 py-5">
                  <p className="text-[0.72rem] font-semibold tracking-[0.14em] text-[var(--color-text-muted)] uppercase">
                    Invited by
                  </p>
                  <h2 className="mt-3 text-[1.2rem] font-semibold tracking-[-0.04em] text-[var(--color-text)]">
                    {preview.data.inviter_display_name}
                  </h2>
                  <div className="mt-2 flex flex-col gap-1 text-sm text-[var(--color-text-muted)]">
                    <p>{preview.data.inviter_email || 'Email unavailable'}</p>
                    <p>Created {formatInviteDate(preview.data.created_at)}</p>
                  </div>
                </div>
              </div>

              <Separator className="bg-black/8" />

              <div className="grid gap-3 rounded-[22px] border border-black/8 bg-white/78 px-5 py-5 text-sm text-[var(--color-text-muted)]">
                <p className="text-[0.72rem] font-semibold tracking-[0.14em] text-[var(--color-text-muted)] uppercase">
                  Granted role
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="accent">
                    {preview.data.role === 'editor' ? 'Editor' : preview.data.role}
                  </Badge>
                  <span>
                    You will be able to edit trip details, activities, map content, and assets.
                  </span>
                </div>
              </div>
            </>
          ) : (
            <div className="rounded-[22px] border border-dashed border-[rgba(196,95,79,0.24)] bg-[rgba(255,240,238,0.84)] px-5 py-6">
              <p className="text-sm leading-6 text-[var(--color-danger)]">{errorMessage}</p>
            </div>
          )}
        </CardContent>

        <CardFooter className="flex flex-wrap justify-between gap-3 border-t border-black/8">
          <Button asChild variant="outline">
            <Link to="/app/trips">Back to trips</Link>
          </Button>

          {preview.data ? (
            <Button onClick={() => void handleAcceptInvite()} disabled={acceptInvitation.isPending}>
              {acceptInvitation.isPending ? (
                <VoyagerLoader data-icon="inline-start" />
              ) : (
                <UserPlus data-icon="inline-start" />
              )}
              Accept and open trip
            </Button>
          ) : null}
        </CardFooter>
      </Card>
    </WorkspacePage>
  );
}
