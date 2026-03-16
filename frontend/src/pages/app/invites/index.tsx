import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, MapPinned, ShieldCheck, UserPlus, Users } from 'lucide-react';
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
import { useAcceptTripInvitation, useTripInvitationPreview } from '@/entities/trip-sharing/queries';
import { isApiError } from '@/shared/api/client';
import { WorkspacePage } from '@/shared/layouts/workspace-shell';
import { VoyagerLoader } from '@/widgets/app-shell/logo';

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
    <WorkspacePage className="flex min-h-[80svh] items-center justify-center p-4">
      <div className="w-full max-w-[540px] animate-in fade-in zoom-in-95 duration-500">
        <Card variant="elevated" className="overflow-hidden rounded-[32px] border-white/60 shadow-xl">
          <CardHeader className="items-center pb-2 text-center">
            <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
              <UserPlus className="size-7" />
            </div>
            <CardTitle className="text-[1.8rem] font-bold tracking-tight text-[var(--color-text)] md:text-[2.2rem]">
              Join the trip
            </CardTitle>
            <CardDescription className="max-w-[320px] text-sm leading-relaxed text-[var(--color-text-muted)]">
              You've been invited to collaborate on a shared itinerary and map context.
            </CardDescription>
          </CardHeader>

          <CardContent className="flex flex-col gap-6 px-6 py-6 md:px-10">
            {preview.isLoading ? (
              <div className="flex flex-col items-center justify-center py-10 text-[var(--color-text-muted)]">
                <VoyagerLoader className="mb-3 size-6" />
                <p className="text-sm font-medium">Fetching invitation details…</p>
              </div>
            ) : preview.data ? (
              <div className="flex flex-col gap-5">
                {/* Trip Info Box */}
                <div className="rounded-2xl border border-[var(--color-border-strong)] bg-[var(--color-secondary-surface)] p-5">
                  <span className="text-[0.68rem] font-semibold tracking-[0.18em] text-[var(--color-text-muted)] uppercase">
                    Shared trip
                  </span>
                  <h2 className="mt-2 text-[1.4rem] font-semibold tracking-[-0.04em] text-[var(--color-text)]">
                    {preview.data.trip_title}
                  </h2>
                  <p className="mt-1 flex items-center gap-1.5 text-sm text-[var(--color-text-muted)]">
                    <MapPinned className="size-3.5" />
                    {preview.data.destination_text}
                  </p>
                </div>

                {/* Meta details */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1">
                    <span className="text-[0.65rem] font-semibold tracking-[0.14em] text-[var(--color-text-muted)] uppercase">
                      Invited by
                    </span>
                    <p className="truncate text-[0.85rem] font-semibold text-[var(--color-text)]">
                      {preview.data.inviter_display_name}
                    </p>
                    <p className="text-[0.72rem] text-[var(--color-text-muted)]">
                      {formatInviteDate(preview.data.created_at)}
                    </p>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[0.65rem] font-semibold tracking-[0.14em] text-[var(--color-text-muted)] uppercase">
                      Your role
                    </span>
                    <div className="flex items-center gap-1.5">
                      <Badge variant="accent" className="h-5 px-1.5 text-[0.68rem]">
                        {preview.data.role === 'editor' ? 'Editor' : preview.data.role}
                      </Badge>
                      <span className="text-[0.72rem] text-[var(--color-text-muted)]">
                        Full access
                      </span>
                    </div>
                  </div>
                </div>

                {/* Security badges */}
                <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
                  <div className="flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-white px-2.5 py-1 text-[0.68rem] font-medium text-[var(--color-text-muted)]">
                    <ShieldCheck className="size-3 text-[var(--color-success)]" />
                    Authenticated access
                  </div>
                  <div className="flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-white px-2.5 py-1 text-[0.68rem] font-medium text-[var(--color-text-muted)]">
                    <Users className="size-3" />
                    Shared editing
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-[var(--color-danger)]/30 bg-[var(--color-danger)]/5 p-6 text-center">
                <p className="text-sm font-medium leading-relaxed text-[var(--color-danger)]">
                  {errorMessage}
                </p>
                <Button asChild variant="link" className="mt-2 text-xs">
                  <Link to="/app/trips">Go back to your trips</Link>
                </Button>
              </div>
            )}
          </CardContent>

          <CardFooter className="flex flex-col gap-3 px-6 pb-8 md:px-10">
            {preview.data ? (
              <>
                <Button
                  onClick={() => void handleAcceptInvite()}
                  disabled={acceptInvitation.isPending}
                  className="h-12 w-full rounded-full text-[0.95rem] font-semibold shadow-md transition-all hover:scale-[1.02] active:scale-[0.98]"
                >
                  {acceptInvitation.isPending ? (
                    <VoyagerLoader className="mr-2 size-4" />
                  ) : (
                    <UserPlus className="mr-2 size-4" />
                  )}
                  Accept and open trip
                </Button>
                <Button asChild variant="ghost" className="h-10 w-full rounded-full text-[0.88rem] text-[var(--color-text-muted)] hover:bg-[var(--color-secondary-surface)]">
                  <Link to="/app/trips">
                    <ArrowLeft className="mr-2 size-3.5" />
                    Back to trips
                  </Link>
                </Button>
              </>
            ) : (
              <Button asChild variant="outline" className="h-11 w-full rounded-full">
                <Link to="/app/trips">Back to trips</Link>
              </Button>
            )}
          </CardFooter>
        </Card>

        {/* Footer info */}
        <p className="mt-6 px-4 text-center text-[0.78rem] leading-relaxed text-[var(--color-text-muted)]">
          By joining, you'll be able to see and edit all activities, assets, and route details
          for this trip. This invitation link is unique to you.
        </p>
      </div>
    </WorkspacePage>
  );
}
