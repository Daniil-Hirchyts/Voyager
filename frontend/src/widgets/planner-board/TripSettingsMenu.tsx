import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useIsMobile } from '@/shared/hooks/use-mobile';
import {
  Copy,
  Clock3,
  Image as ImageIcon,
  Link2,
  RefreshCw,
  Settings2,
  Trash2,
  Upload,
  UserMinus,
  UserPlus,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PhotoViewer, PhotoViewerProvider } from '@/components/ui/photo-viewer';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { DatePicker } from '@/components/ui/date-picker';
import { Combobox } from '@/components/ui/combobox';
import { buildTripInviteUrl } from '@/entities/trip-sharing/api';
import {
  useCreateTripInvite,
  useRemoveTripCollaborator,
  useRevokeTripInvite,
  useTripSharing,
} from '@/entities/trip-sharing/queries';
import { useTripCoverPhotoManager } from '@/entities/trip/useTripCoverPhotoManager';
import { useUploadTripAsset } from '@/entities/trip-asset/queries';
import { useDestinationAutocomplete } from '@/entities/place/queries';
import { useDeleteTrip, useDuplicateTrip, usePatchTrip, useTrip } from '@/entities/trip/queries';
import type { RouteTravelMode, TripCollaborator, TripInvitation } from '@/shared/api/types';
import { CURRENCY_OPTIONS } from '@/shared/lib/currencies';
import { resolvePhotoUrl } from '@/shared/lib/media';
import TripAssetManager from '@/widgets/trip-assets';
import { ROUTE_TRAVEL_MODE_OPTIONS } from './travel-modes';
import { cn } from '@/shared/lib/cn';
import { VoyagerLoader } from '@/widgets/app-shell/logo';

const fieldLabelClassName =
  'text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[var(--color-text-muted)]';
const TRIP_TYPES = [
  'leisure',
  'business',
  'adventure',
  'cultural',
  'family',
  'romantic',
  'solo',
  'group',
] as const;

type TripSettingsForm = {
  title: string;
  destination_text: string;
  start_date: string;
  end_date: string;
  budget_amount: string;
  budget_currency: string;
  trip_type: string;
  route_travel_mode: RouteTravelMode;
};

function toTripSettingsForm(
  value: NonNullable<ReturnType<typeof useTrip>['data']>,
): TripSettingsForm {
  return {
    title: value.title,
    destination_text: value.destination_text,
    start_date: value.start_date,
    end_date: value.end_date,
    budget_amount: value.budget_amount ? String(value.budget_amount) : '',
    budget_currency: value.budget_currency ?? 'USD',
    trip_type: value.trip_type ?? 'leisure',
    route_travel_mode: value.route_travel_mode ?? 'WALK',
  };
}

function formatInviteDate(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value));
}

function getCollaboratorName(collaborator: TripCollaborator) {
  return collaborator.display_name || collaborator.email || 'Traveler';
}

function getInvitationLabel(invitation: TripInvitation) {
  return invitation.role === 'editor' ? 'Editor invite' : invitation.role;
}

interface TripSettingsMenuProps {
  tripId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  collaborationOpen?: boolean;
  onCollaborationOpenChange?: (open: boolean) => void;
  hasActivities?: boolean;
  onReset?: (dayIds: string[] | undefined, idempotencyKey: string) => Promise<void>;
}

export function TripSettingsMenu({
  tripId,
  open,
  onOpenChange,
  collaborationOpen,
  onCollaborationOpenChange,
  hasActivities,
  onReset,
}: TripSettingsMenuProps) {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { data: trip } = useTrip(tripId);
  const sharing = useTripSharing(tripId);
  const createTripInvite = useCreateTripInvite(tripId);
  const revokeTripInvite = useRevokeTripInvite(tripId);
  const removeTripCollaborator = useRemoveTripCollaborator(tripId);
  const patchTrip = usePatchTrip(tripId);
  const uploadTripAsset = useUploadTripAsset(tripId);
  const duplicateTrip = useDuplicateTrip();
  const deleteTrip = useDeleteTrip();
  const coverUploadInputRef = useRef<HTMLInputElement | null>(null);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [isUploadingCoverPhoto, setIsUploadingCoverPhoto] = useState(false);
  const [form, setForm] = useState<TripSettingsForm>({
    title: '',
    destination_text: '',
    start_date: '',
    end_date: '',
    budget_amount: '',
    budget_currency: 'USD',
    trip_type: 'leisure',
    route_travel_mode: 'WALK',
  });

  const [destinationSearchQuery, setDestinationSearchQuery] = useState('');
  const deferredDestinationQuery = useDeferredValue(destinationSearchQuery.trim());
  const destinationSearch = useDestinationAutocomplete(
    { q: deferredDestinationQuery, limit: 8, offset: 0 },
    deferredDestinationQuery.length >= 2,
  );
  const destinationOptions = useMemo(() => {
    const items = (destinationSearch.data?.items ?? []).map((item) => ({
      value: item.label,
      label: item.label,
      description: item.address_text ?? undefined,
    }));

    if (form.destination_text && !items.find((i) => i.value === form.destination_text)) {
      items.unshift({
        value: form.destination_text,
        label: form.destination_text,
        description: undefined,
      });
    }

    return items;
  }, [destinationSearch.data?.items, form.destination_text]);
  const dupKey = useMemo(() => crypto.randomUUID(), []);
  const {
    coverPreference,
    coverPhotoCandidates,
    selectedCoverPhoto,
    isCoverPhotoBusy,
    coverPhotosLoading,
    coverPhotoRefreshError,
    resolvedPlaceId,
    handlePhotoSelection,
    commitPhotoSelection,
    handleCoverPhotoRefresh,
  } = useTripCoverPhotoManager(tripId, trip);

  const isOwner = trip?.current_user_role === 'owner';
  const collaborators = sharing.data?.collaborators ?? [];
  const pendingInvitations = sharing.data?.pending_invitations ?? [];
  const totalMembers = collaborators.length;

  useEffect(() => {
    if (!trip) {
      return;
    }
    setForm(toTripSettingsForm(trip));
  }, [trip, open]);

  async function handleSave() {
    if (!trip) {
      return;
    }

    const nextTripData = {
      title: form.title.trim(),
      destination_text: form.destination_text.trim(),
      start_date: form.start_date,
      end_date: form.end_date,
      budget_amount: form.budget_amount ? Number(form.budget_amount) : null,
      budget_currency: form.budget_currency,
      trip_type: form.trip_type,
      route_travel_mode: form.route_travel_mode,
    };
    const hasTripChanges =
      nextTripData.title !== trip.title ||
      nextTripData.destination_text !== trip.destination_text ||
      nextTripData.start_date !== trip.start_date ||
      nextTripData.end_date !== trip.end_date ||
      (nextTripData.budget_amount != null ? String(nextTripData.budget_amount) : null) !==
        (trip.budget_amount ?? null) ||
      nextTripData.budget_currency !== trip.budget_currency ||
      nextTripData.trip_type !== trip.trip_type ||
      nextTripData.route_travel_mode !== trip.route_travel_mode;

    try {
      await commitPhotoSelection();
      if (hasTripChanges) {
        await patchTrip.mutateAsync({
          version: trip.version,
          data: nextTripData,
        });
      }
      toast.success('Trip settings saved');
      onOpenChange(false);
    } catch {
      toast.error('Could not save trip settings');
    }
  }

  async function handleDuplicate() {
    try {
      const duplicated = await duplicateTrip.mutateAsync({
        tripId,
        idempotencyKey: dupKey,
      });
      toast.success('Trip duplicated');
      onOpenChange(false);
      navigate(`/app/trips/${duplicated.id}`);
    } catch {
      toast.error('Could not duplicate this trip');
    }
  }

  async function handleDelete() {
    try {
      await deleteTrip.mutateAsync(tripId);
      toast.success('Trip deleted');
      onOpenChange(false);
      navigate('/app/trips');
    } catch {
      toast.error('Could not delete this trip');
    } finally {
      setShowDeleteConfirm(false);
    }
  }

  async function handleReset() {
    if (!onReset) return;
    setIsResetting(true);
    try {
      await onReset(undefined, crypto.randomUUID());
      toast.success('Itinerary reset');
      setShowResetConfirm(false);
    } catch {
      toast.error('Could not reset itinerary');
    } finally {
      setIsResetting(false);
    }
  }

  async function handleCoverUpload(fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file) {
      return;
    }

    setIsUploadingCoverPhoto(true);
    try {
      const uploaded = await uploadTripAsset.mutateAsync({ file, activityId: null });
      handlePhotoSelection(uploaded.id, 'uploaded');
      toast.success('Cover photo uploaded');
    } catch {
      toast.error('Could not upload cover photo');
    } finally {
      setIsUploadingCoverPhoto(false);
    }
  }

  async function copyInviteUrl(invitation: Pick<TripInvitation, 'invite_path'>) {
    const inviteUrl = buildTripInviteUrl(invitation);

    try {
      await navigator.clipboard.writeText(inviteUrl);
      toast.success('Invite link copied');
      return true;
    } catch {
      toast.error('Could not copy invite link');
      return false;
    }
  }

  async function handleCreateInvite() {
    try {
      const response = await createTripInvite.mutateAsync();
      const copied = await copyInviteUrl(response.invitation);
      if (!copied) {
        toast.success('Invite link created');
      }
    } catch {
      toast.error('Could not create invite link');
    }
  }

  async function handleCopyInvite(invitation: TripInvitation) {
    await copyInviteUrl(invitation);
  }

  async function handleRevokeInvite(invitationId: string) {
    try {
      await revokeTripInvite.mutateAsync(invitationId);
      toast.success('Invite revoked');
    } catch {
      toast.error('Could not revoke invite');
    }
  }

  async function handleRemoveCollaborator(collaboratorUserId: string) {
    try {
      await removeTripCollaborator.mutateAsync(collaboratorUserId);
      toast.success('Collaborator removed');
    } catch {
      toast.error('Could not remove collaborator');
    }
  }

  if (!trip) return null;

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side={isMobile ? 'bottom' : 'left'}
          className={
            isMobile
              ? 'flex h-[92dvh] flex-col gap-0 overflow-hidden rounded-t-[24px] p-0 sm:max-w-none'
              : 'left-14 flex h-[100dvh] w-[calc(100vw-56px)] max-w-[calc(100vw-56px)] flex-col gap-0 overflow-hidden p-0 lg:w-[clamp(380px,46vw,500px)] lg:max-w-[clamp(380px,46vw,500px)]'
          }
        >
          <SheetHeader className="shrink-0 border-b border-[var(--color-border)] bg-white px-6 py-5">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-black text-white">
                <Settings2 className="size-5" />
              </div>
              <div>
                <SheetTitle className="text-lg font-bold tracking-tight">Trip Settings</SheetTitle>
                <SheetDescription className="text-xs font-medium text-black/40">
                  Manage your journey parameters and assets
                </SheetDescription>
              </div>
            </div>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="flex flex-col gap-8 px-6 py-8 pb-12">
              <div className="flex flex-col gap-6">
                <div className="grid gap-5 sm:grid-cols-2">
                  <div className="flex flex-col gap-2 sm:col-span-2">
                    <label className={fieldLabelClassName}>Trip Title</label>
                    <Input
                      value={form.title}
                      maxLength={100}
                      className="h-11 rounded-[14px] border-[var(--color-border)] bg-[var(--color-secondary-surface)] focus-visible:ring-[var(--color-border)]"
                      onChange={(event) =>
                        setForm((current) => ({ ...current, title: event.target.value }))
                      }
                    />
                  </div>

                  <div className="flex flex-col gap-2 sm:col-span-2">
                    <label className={fieldLabelClassName}>Destination</label>
                    <Combobox
                      value={form.destination_text}
                      onValueChange={(value) => setForm((f) => ({ ...f, destination_text: value }))}
                      onSearchChange={setDestinationSearchQuery}
                      options={destinationOptions}
                      placeholder="Search for a city..."
                      searchPlaceholder="Type to search..."
                      emptyText={
                        destinationSearch.isFetching ? 'Searching...' : 'No destinations found'
                      }
                      isLoading={destinationSearch.isFetching}
                      triggerClassName="h-11 rounded-[14px] border-[var(--color-border)] bg-[var(--color-secondary-surface)] focus:ring-[var(--color-border)]"
                    />
                  </div>

                  <div className="flex flex-col gap-2">
                    <label className={fieldLabelClassName}>Start Date</label>
                    <DatePicker
                      value={form.start_date}
                      onChange={(value) => setForm((f) => ({ ...f, start_date: value }))}
                      className="h-11 rounded-[14px] border-[var(--color-border)] bg-[var(--color-secondary-surface)] focus:ring-[var(--color-border)]"
                    />
                  </div>

                  <div className="flex flex-col gap-2">
                    <label className={fieldLabelClassName}>End Date</label>
                    <DatePicker
                      value={form.end_date}
                      onChange={(value) => setForm((f) => ({ ...f, end_date: value }))}
                      className="h-11 rounded-[14px] border-[var(--color-border)] bg-[var(--color-secondary-surface)] focus:ring-[var(--color-border)]"
                    />
                  </div>

                  <div className="flex flex-col gap-2">
                    <label className={fieldLabelClassName}>Budget Amount</label>
                    <Input
                      type="number"
                      min={0}
                      max={1000000000}
                      step="0.01"
                      value={form.budget_amount}
                      className="h-11 rounded-[14px] border-[var(--color-border)] bg-[var(--color-secondary-surface)] focus-visible:ring-[var(--color-border)]"
                      onChange={(event) =>
                        setForm((current) => ({ ...current, budget_amount: event.target.value }))
                      }
                      placeholder="Optional"
                    />
                  </div>

                  <div className="flex flex-col gap-2">
                    <label className={fieldLabelClassName}>Currency</label>
                    <Select
                      value={form.budget_currency}
                      onValueChange={(value) =>
                        setForm((current) => ({ ...current, budget_currency: value }))
                      }
                    >
                      <SelectTrigger className="h-11 rounded-[14px] border-[var(--color-border)] bg-[var(--color-secondary-surface)] focus:ring-[var(--color-border)]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="max-h-64 rounded-[18px] border-[var(--color-border)]">
                        {CURRENCY_OPTIONS.map((option) => (
                          <SelectItem
                            key={option.value}
                            value={option.value}
                            className="rounded-[12px]"
                          >
                            {option.label}
                            {option.description ? ` ${option.description}` : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex flex-col gap-2 sm:col-span-2">
                    <label className={fieldLabelClassName}>Trip Type</label>
                    <Select
                      value={form.trip_type}
                      onValueChange={(value) =>
                        setForm((current) => ({ ...current, trip_type: value }))
                      }
                    >
                      <SelectTrigger className="h-11 rounded-[14px] border-[var(--color-border)] bg-[var(--color-secondary-surface)] focus:ring-[var(--color-border)]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="rounded-[18px] border-[var(--color-border)]">
                        {TRIP_TYPES.map((tripType) => (
                          <SelectItem
                            key={tripType}
                            value={tripType}
                            className="rounded-[12px] capitalize"
                          >
                            {tripType.replace(/_/g, ' ')}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex flex-col gap-2 sm:col-span-2">
                    <label className={fieldLabelClassName}>Travel Mode</label>
                    <Select
                      value={form.route_travel_mode}
                      onValueChange={(value) =>
                        setForm((current) => ({
                          ...current,
                          route_travel_mode: value as RouteTravelMode,
                        }))
                      }
                    >
                      <SelectTrigger
                        aria-label="Travel time mode"
                        className="h-11 rounded-[14px] border-[var(--color-border)] bg-[var(--color-secondary-surface)] focus:ring-[var(--color-border)]"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="rounded-[18px] border-[var(--color-border)]">
                        {ROUTE_TRAVEL_MODE_OPTIONS.map((option) => (
                          <SelectItem
                            key={option.value}
                            value={option.value}
                            className="rounded-[12px]"
                          >
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="px-1 text-[0.7rem] font-medium text-black/40">
                      Determines travel estimates and route optimization.
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className={fieldLabelClassName}>Collaboration</label>
                  <Button
                    variant="outline"
                    className="h-11 w-full justify-between rounded-[14px] border-[var(--color-border)] bg-[var(--color-secondary-surface)] px-4 font-normal text-[var(--color-text)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"
                    onClick={() => onCollaborationOpenChange?.(true)}
                  >
                    <span className="flex items-center gap-2">
                      <Users className="size-4 text-[var(--color-text-muted)]" />
                      Manage access
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-[var(--color-text-muted)]">
                        {totalMembers} {totalMembers === 1 ? 'member' : 'members'}
                      </span>
                      <span className="flex size-5 items-center justify-center rounded-full bg-black/5 text-[0.6rem] text-black/40">
                        {'>'}
                      </span>
                    </div>
                  </Button>
                </div>
              </div>

              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <label className={fieldLabelClassName}>Cover Photo</label>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 rounded-full px-3 text-[0.7rem] font-bold"
                      onClick={() => void handleCoverPhotoRefresh()}
                      disabled={!resolvedPlaceId || isCoverPhotoBusy}
                    >
                      <RefreshCw className={cn('mr-1.5 size-3.5', isCoverPhotoBusy && '')} />
                      Refresh
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 rounded-full px-3 text-[0.7rem] font-bold"
                      onClick={() => coverUploadInputRef.current?.click()}
                      disabled={isUploadingCoverPhoto}
                    >
                      {isUploadingCoverPhoto ? (
                        <VoyagerLoader className="mr-1.5 size-3.5" />
                      ) : (
                        <Upload className="mr-1.5 size-3.5" />
                      )}
                      Upload
                    </Button>
                  </div>
                </div>

                <input
                  ref={coverUploadInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(event) => {
                    void handleCoverUpload(event.target.files);
                    event.target.value = '';
                  }}
                />

                <PhotoViewerProvider>
                  <div className="grid grid-cols-3 gap-2">
                    {coverPhotosLoading && coverPhotoCandidates.length === 0 ? (
                      Array.from({ length: 3 }).map((_, index) => (
                        <div
                          key={index}
                          className="aspect-square animate-pulse rounded-[16px] bg-[var(--color-secondary-surface)]"
                        />
                      ))
                    ) : coverPhotoCandidates.length > 0 ? (
                      coverPhotoCandidates.slice(0, 6).map((photo) => {
                        const thumbUrl = resolvePhotoUrl(photo, 'thumb');
                        const fullUrl = resolvePhotoUrl(photo, 'full') || thumbUrl;
                        const isActive =
                          coverPreference?.assetId === photo.id ||
                          coverPreference?.photoId === photo.id ||
                          (!coverPreference?.assetId &&
                            !coverPreference?.photoId &&
                            selectedCoverPhoto?.id === photo.id);

                        return (
                          <div key={photo.id} className="relative">
                            {thumbUrl ? (
                              <PhotoViewer
                                src={fullUrl}
                                triggers={['onDoubleClick']}
                                overlay={
                                  photo.attribution_text ? (
                                    <div className="absolute inset-x-4 bottom-4 rounded-[14px] bg-black/58 px-3 py-2 text-[0.72rem] text-white backdrop-blur-sm">
                                      {photo.attribution_text}
                                    </div>
                                  ) : undefined
                                }
                              >
                                <button
                                  type="button"
                                  onClick={() =>
                                    handlePhotoSelection(photo.id, photo.candidateSource)
                                  }
                                  className={cn(
                                    'relative aspect-square w-full overflow-hidden rounded-[16px] border-2 transition-all',
                                    isActive
                                      ? 'scale-[0.98] border-black'
                                      : 'border-transparent opacity-60 hover:scale-[1.02] hover:opacity-100',
                                  )}
                                >
                                  <img
                                    src={thumbUrl}
                                    alt=""
                                    className="h-full w-full object-cover"
                                  />
                                </button>
                              </PhotoViewer>
                            ) : (
                              <button
                                type="button"
                                onClick={() =>
                                  handlePhotoSelection(photo.id, photo.candidateSource)
                                }
                                className={cn(
                                  'relative aspect-square w-full overflow-hidden rounded-[16px] border-2 transition-all',
                                  isActive
                                    ? 'scale-[0.98] border-black'
                                    : 'border-transparent opacity-60 hover:scale-[1.02] hover:opacity-100',
                                )}
                              >
                                <div className="flex h-full w-full items-center justify-center bg-[var(--color-secondary-surface)] text-black/20">
                                  <ImageIcon className="size-5" />
                                </div>
                              </button>
                            )}
                          </div>
                        );
                      })
                    ) : (
                      <div className="col-span-3 rounded-[18px] border border-dashed border-[var(--color-border)] py-8 text-center text-[0.8rem] text-black/40">
                        {coverPhotoRefreshError || 'No city photos available.'}
                      </div>
                    )}
                  </div>
                </PhotoViewerProvider>
              </div>

              <div className="flex flex-col gap-4">
                <TripAssetManager tripId={tripId} className="border-none bg-transparent p-0" />
              </div>

              <div className="flex flex-col gap-4 pt-4">
                <label className={fieldLabelClassName}>Management</label>
                <div className="flex flex-col gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 justify-start rounded-[14px] border-[var(--color-border)] px-4 text-[0.82rem] font-semibold text-[var(--color-text)] hover:bg-[var(--color-border)]"
                    onClick={() => void handleDuplicate()}
                    disabled={duplicateTrip.isPending}
                  >
                    {duplicateTrip.isPending ? (
                      <VoyagerLoader className="mr-3 size-4 text-[var(--color-text-muted)]" />
                    ) : (
                      <Copy className="mr-3 size-4 text-[var(--color-text-muted)]" />
                    )}
                    Duplicate Trip
                  </Button>
                  {onReset && hasActivities && (
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11 justify-start rounded-[14px] border-[var(--color-border)] px-4 text-[0.82rem] font-semibold text-[var(--color-warning)] hover:bg-[var(--color-border)] hover:text-[#E59200]"
                      onClick={() => setShowResetConfirm(true)}
                      disabled={isResetting}
                    >
                      {isResetting ? (
                        <VoyagerLoader className="mr-3 size-4" />
                      ) : (
                        <RefreshCw className="mr-3 size-4" />
                      )}
                      Reset Itinerary
                    </Button>
                  )}
                  {isOwner ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11 justify-start rounded-[14px] border-[var(--color-border)] px-4 text-[0.82rem] font-semibold text-[var(--color-danger)] hover:bg-[var(--color-border)] hover:text-[#E5480D]"
                      onClick={() => setShowDeleteConfirm(true)}
                    >
                      <Trash2 className="mr-3 size-4" />
                      Delete Trip Permanently
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center justify-between border-t border-[var(--color-border)] bg-white px-6 py-5">
            <Button
              variant="ghost"
              className="rounded-full px-6 font-bold text-black/40 hover:text-black"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              className="-black/10 h-11 rounded-full px-8 font-bold transition-transform active:scale-[0.98]"
              onClick={handleSave}
              disabled={patchTrip.isPending}
            >
              {patchTrip.isPending ? <VoyagerLoader className="mr-2 size-4" /> : null}
              Save Changes
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent className="rounded-[28px] border-none">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-xl font-bold">Delete this trip?</AlertDialogTitle>
            <AlertDialogDescription className="text-sm font-medium text-black/60">
              This action is irreversible. All planning data for{' '}
              <span className="font-bold text-black">"{trip.title}"</span> will be permanently
              removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-4">
            <AlertDialogCancel className="rounded-full border-none bg-[var(--color-secondary-surface)] px-6 font-bold">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="rounded-full bg-[var(--color-danger)] px-6 font-bold text-white hover:bg-[#E5480D]"
              onClick={(event) => {
                event.preventDefault();
                void handleDelete();
              }}
            >
              {deleteTrip.isPending ? <VoyagerLoader className="mr-2 size-4" /> : null}
              Delete Permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showResetConfirm} onOpenChange={setShowResetConfirm}>
        <AlertDialogContent className="rounded-[28px] border-none">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-xl font-bold">Reset itinerary?</AlertDialogTitle>
            <AlertDialogDescription className="text-sm font-medium text-black/60">
              All activities will be permanently removed from this trip. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-4">
            <AlertDialogCancel className="rounded-full border-none bg-[var(--color-secondary-surface)] px-6 font-bold">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="rounded-full bg-[var(--color-warning)] px-6 font-bold text-white hover:bg-[#E59200]"
              onClick={(event) => {
                event.preventDefault();
                void handleReset();
              }}
            >
              {isResetting ? <VoyagerLoader className="mr-2 size-4" /> : null}
              Confirm Reset
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Sheet open={collaborationOpen} onOpenChange={onCollaborationOpenChange}>
        <SheetContent
          side={isMobile ? 'bottom' : 'left'}
          className={
            isMobile
              ? 'flex h-[90dvh] flex-col gap-0 overflow-hidden rounded-t-[24px] border-x-0 border-b-0 bg-white p-0 sm:max-w-none'
              : 'left-14 flex h-[100dvh] w-[calc(100vw-56px)] max-w-[calc(100vw-56px)] flex-col gap-0 overflow-hidden border-r border-[var(--color-border)] bg-white p-0 lg:w-[clamp(380px,46vw,500px)] lg:max-w-[clamp(380px,46vw,500px)]'
          }
        >
          <SheetHeader className="shrink-0 border-b border-[var(--color-border)] p-6 pr-[120px] pb-6">
            <div className="flex flex-col gap-2.5 text-left">
              <SheetTitle className="text-xl font-bold tracking-tight text-[var(--color-text)]">
                Collaboration
              </SheetTitle>
              <SheetDescription className="text-sm leading-relaxed text-[var(--color-text-muted)]">
                {isOwner
                  ? 'Create a single-use invite link so other signed-in travelers can edit this trip with you.'
                  : 'This trip is shared with you. Members can edit the itinerary together, while only the owner can manage invites and access.'}
              </SheetDescription>
            </div>
          </SheetHeader>

          <div className="min-h-0 flex-1 overflow-y-auto p-6">
            <div className="flex flex-col gap-10">
              <div className="flex flex-col gap-4">
                <h3 className="text-[0.68rem] font-bold tracking-[0.14em] text-[var(--color-text-muted)] uppercase">
                  Members
                </h3>

                {sharing.isLoading ? (
                  <div className="py-2 text-sm text-[var(--color-text-muted)]">
                    Loading collaborators…
                  </div>
                ) : sharing.isError ? (
                  <div className="py-2 text-sm text-[var(--color-text-muted)]">
                    Could not load sharing details.
                  </div>
                ) : (
                  <div className="flex flex-col gap-1">
                    {collaborators.map((collaborator) => {
                      const isOwnerRow = collaborator.role === 'owner';
                      const canRemove = isOwner && !isOwnerRow;

                      return (
                        <div
                          key={`${collaborator.user_id}-${collaborator.role}`}
                          className="group flex items-center justify-between gap-3 py-2"
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <Avatar className="size-10 border border-[var(--color-border)]">
                              {collaborator.avatar_url ? (
                                <AvatarImage
                                  src={collaborator.avatar_url}
                                  alt={getCollaboratorName(collaborator)}
                                />
                              ) : null}
                              <AvatarFallback className="bg-[#ECEEF0] text-[0.7rem] font-semibold tracking-wide text-[var(--color-text-muted)]">
                                {getCollaboratorName(collaborator)
                                  .split(/\s+/)
                                  .filter(Boolean)
                                  .slice(0, 2)
                                  .map((p: string) => p[0]?.toUpperCase())
                                  .join('') || 'V'}
                              </AvatarFallback>
                            </Avatar>
                            <div className="flex min-w-0 flex-1 flex-col">
                              <div className="flex items-center gap-2">
                                <span className="truncate text-sm leading-none font-semibold text-[var(--color-text)]">
                                  {getCollaboratorName(collaborator)}
                                </span>
                                {isOwnerRow ? (
                                  <Badge
                                    variant="outline"
                                    className="h-[22px] border-[var(--color-border)] bg-transparent px-2 text-[0.65rem] font-semibold tracking-wider whitespace-nowrap text-black/60 uppercase"
                                  >
                                    Owner
                                  </Badge>
                                ) : null}
                              </div>
                              <span className="mt-1 truncate text-[0.8rem] leading-none text-[var(--color-text-muted)]">
                                {collaborator.email || 'No email available'}
                              </span>
                            </div>
                          </div>

                          {canRemove && collaborator.id ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-8 shrink-0 rounded-full text-black/40 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-[var(--color-border)] hover:text-[var(--color-danger)]"
                              onClick={() => void handleRemoveCollaborator(collaborator.user_id)}
                              disabled={removeTripCollaborator.isPending}
                              title="Remove member"
                            >
                              <UserMinus className="size-4" />
                            </Button>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="h-px bg-[var(--color-border)]" />

              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-[0.68rem] font-bold tracking-[0.14em] text-[var(--color-text-muted)] uppercase">
                    {isOwner ? 'Pending invites' : 'Access rules'}
                  </h3>
                  {isOwner ? (
                    <Button
                      type="button"
                      className="h-8 shrink-0 rounded-full px-4 text-xs font-semibold"
                      onClick={() => void handleCreateInvite()}
                      disabled={createTripInvite.isPending}
                    >
                      {createTripInvite.isPending ? (
                        <VoyagerLoader className="mr-2 size-3.5" />
                      ) : (
                        <UserPlus className="mr-2 size-3.5" />
                      )}
                      Create invite link
                    </Button>
                  ) : null}
                </div>

                {isOwner ? (
                  sharing.isLoading ? (
                    <div className="py-2 text-sm leading-relaxed text-[var(--color-text-muted)]">
                      Loading pending invites…
                    </div>
                  ) : pendingInvitations.length > 0 ? (
                    <div className="flex flex-col gap-3">
                      {pendingInvitations.map((invitation) => (
                        <div
                          key={invitation.id}
                          className="group flex items-center justify-between gap-3 rounded-[12px] border border-[var(--color-border)] bg-transparent p-3.5 transition-colors hover:bg-black/[0.02]"
                        >
                          <div className="flex min-w-0 flex-col gap-2">
                            <div className="flex items-center gap-2">
                              <Badge
                                variant="warning"
                                className="h-[22px] border border-[#E9D9B7] bg-[#FDF6E9] px-2 text-[0.65rem] font-semibold tracking-wider whitespace-nowrap text-[#A27B3D]"
                              >
                                <Link2 className="mr-1.5 size-3" />
                                {getInvitationLabel(invitation)}
                              </Badge>
                            </div>
                            <span className="flex items-center gap-1.5 text-[0.8rem] whitespace-nowrap text-[var(--color-text-muted)]">
                              <Clock3 className="size-3.5 shrink-0" />
                              Created {formatInviteDate(invitation.created_at)}
                            </span>
                          </div>

                          <div className="flex shrink-0 items-center gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-8 rounded-full text-black/60 hover:bg-[var(--color-border)] hover:text-black"
                              onClick={() => void handleCopyInvite(invitation)}
                              title="Copy link"
                            >
                              <Copy className="size-3.5" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-8 rounded-full text-black/40 hover:bg-[var(--color-border)] hover:text-[var(--color-danger)]"
                              onClick={() => void handleRevokeInvite(invitation.id)}
                              disabled={revokeTripInvite.isPending}
                              title="Revoke link"
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-[16px] border border-dashed border-[var(--color-border)] bg-black/[0.02] p-4 text-sm leading-relaxed text-[var(--color-text-muted)]">
                      No active invite links. Create one when you want another traveler to
                      collaborate on this trip.
                    </div>
                  )
                ) : (
                  <div className="rounded-[16px] border border-dashed border-[var(--color-border)] bg-black/[0.02] p-4 text-sm leading-relaxed text-[var(--color-text-muted)]">
                    You can edit trip details, activities, assets, and map content. Only the trip
                    owner can create invite links, revoke access, or delete the trip.
                  </div>
                )}
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
