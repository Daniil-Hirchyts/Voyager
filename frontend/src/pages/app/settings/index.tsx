import { type ChangeEvent, useEffect, useRef, useState } from 'react';
import { useAuth } from 'react-oidc-context';
import { Camera, Map, Sparkles, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DEFAULT_VOYAGER_PREFERENCES,
  mergeVoyagerPreferences,
  readVoyagerPreferences,
  type RecommendationAudiencePreference,
} from '@/entities/user/preferences';
import {
  useDeleteProfileAvatar,
  usePatchProfile,
  useProfile,
  useUploadProfileAvatar,
} from '@/entities/user/queries';
import { WorkspacePage } from '@/shared/layouts/workspace-shell';
import { Skeleton } from '@/components/ui/skeleton';

const sectionClassName = 'rounded-xl border border-black/5 bg-white p-6';
const fieldLabelClassName =
  'text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-[var(--color-text-muted)]';

const AUDIENCE_OPTIONS: Array<{
  value: RecommendationAudiencePreference;
  label: string;
}> = [
  { value: 'any', label: 'Any traveler' },
  { value: 'families', label: 'Families' },
  { value: 'couples', label: 'Couples' },
  { value: 'friends', label: 'Friends' },
  { value: 'solo_travelers', label: 'Solo travelers' },
];

function getInitials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || 'V'
  );
}

export default function SettingsPage() {
  const auth = useAuth();
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const { data: profile, isLoading } = useProfile();
  const patchSettings = usePatchProfile();
  const patchAccount = usePatchProfile();
  const uploadAvatar = useUploadProfileAvatar();
  const deleteAvatar = useDeleteProfileAvatar();
  const [settings, setSettings] = useState(DEFAULT_VOYAGER_PREFERENCES);
  const [account, setAccount] = useState({
    firstName: '',
    lastName: '',
  });

  useEffect(() => {
    if (!profile) {
      return;
    }
    setSettings(readVoyagerPreferences(profile));
    setAccount({
      firstName: profile.first_name ?? '',
      lastName: profile.last_name ?? '',
    });
  }, [profile]);

  async function handleSaveSettings() {
    if (!profile) {
      return;
    }

    try {
      await patchSettings.mutateAsync({
        preferences: mergeVoyagerPreferences(profile.preferences, settings),
      });
      toast.success('App settings saved');
    } catch {
      toast.error('Could not save app settings');
    }
  }

  async function handleSaveAccount() {
    const firstName = account.firstName.trim();
    const lastName = account.lastName.trim();

    if (!firstName || !lastName) {
      toast.error('First and last name are required');
      return;
    }

    try {
      await patchAccount.mutateAsync({
        first_name: firstName,
        last_name: lastName,
      });
      toast.success('Account details saved');
    } catch {
      toast.error('Could not save account details');
    }
  }

  async function handleAvatarInputChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) {
      return;
    }

    try {
      await uploadAvatar.mutateAsync(file);
      toast.success('Avatar updated');
    } catch {
      toast.error('Could not update avatar');
    }
  }

  async function handleAvatarRemove() {
    try {
      await deleteAvatar.mutateAsync();
      toast.success('Avatar removed');
    } catch {
      toast.error('Could not remove avatar');
    }
  }

  const displayName =
    profile?.display_name || (auth.user?.profile?.name as string | undefined) || 'Traveler';
  const userEmail =
    profile?.email ||
    (auth.user?.profile?.email as string | undefined) ||
    profile?.keycloak_sub ||
    'Signed in';
  const avatarUrl =
    profile?.avatar_thumbnail_url ||
    profile?.avatar_url ||
    (auth.user?.profile?.picture as string | undefined);
  const accountDirty =
    account.firstName.trim() !== (profile?.first_name ?? '') ||
    account.lastName.trim() !== (profile?.last_name ?? '');
  const avatarBusy = uploadAvatar.isPending || deleteAvatar.isPending;
  const accountBusy = patchAccount.isPending || avatarBusy;

  if (isLoading) {
    return (
      <WorkspacePage className="gap-4">
        <div className="flex items-center justify-between gap-4 rounded-xl border border-black/5 bg-white p-5">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-16 rounded-full" />
            <Skeleton className="h-6 w-32" />
          </div>
          <Skeleton className="h-10 w-28 rounded-lg" />
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <div className={sectionClassName}>
            <div className="flex items-center gap-3">
              <Skeleton className="size-10 rounded-full" />
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3.5 w-52" />
              </div>
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <Skeleton className="h-10 rounded-[14px]" />
              <Skeleton className="h-10 rounded-[14px]" />
              <Skeleton className="h-10 rounded-[14px] sm:col-span-2" />
            </div>
          </div>
          <div className={sectionClassName}>
            <div className="flex items-center gap-3">
              <Skeleton className="size-10 rounded-full" />
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-44" />
                <Skeleton className="h-3.5 w-52" />
              </div>
            </div>
            <div className="mt-5 grid gap-4">
              <Skeleton className="h-14 rounded-[16px]" />
              <Skeleton className="h-14 rounded-[16px]" />
            </div>
          </div>
          <div className={`${sectionClassName} xl:col-span-2`}>
            <div className="flex items-center gap-3">
              <Skeleton className="size-10 rounded-full" />
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-3.5 w-36" />
              </div>
            </div>
            <div className="mt-5 grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
              <Skeleton className="h-48 rounded-lg" />
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Skeleton className="h-16 rounded-[14px]" />
                  <Skeleton className="h-16 rounded-[14px]" />
                </div>
                <Skeleton className="h-20 rounded-lg" />
              </div>
            </div>
          </div>
        </div>
      </WorkspacePage>
    );
  }

  return (
    <WorkspacePage className="gap-4">
      <div className="flex items-center justify-between gap-4 rounded-xl border border-black/5 bg-white p-5">
        <div className="flex flex-col gap-1.5">
          <span className="w-fit rounded-full bg-[var(--color-accent-soft)] px-2.5 py-0.5 text-[9px] font-bold tracking-[0.14em] text-[var(--color-text-muted)] uppercase">
            Settings
          </span>
          <h1 className="text-xl font-semibold tracking-[-0.03em] text-[var(--color-text)]">
            App defaults
          </h1>
        </div>
        <Button
          onClick={() => void handleSaveSettings()}
          disabled={patchSettings.isPending || isLoading}
          className="h-10 rounded-lg px-6"
        >
          {patchSettings.isPending ? 'Saving…' : 'Save settings'}
        </Button>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className={sectionClassName}>
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-full bg-[rgba(255,140,98,0.14)] text-[var(--color-text)]">
              <Sparkles className="size-4" />
            </span>
            <div>
              <h2 className="text-[1rem] font-semibold tracking-[-0.02em] text-[var(--color-text)]">
                Recommendation defaults
              </h2>
              <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                Controls for planner discovery.
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="space-y-2">
              <span className={fieldLabelClassName}>Result limit</span>
              <Input
                type="number"
                min={3}
                max={12}
                value={settings.recommendations.resultLimit}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    recommendations: {
                      ...current.recommendations,
                      resultLimit: Math.min(12, Math.max(3, Number(event.target.value) || 6)),
                    },
                  }))
                }
              />
            </label>

            <label className="space-y-2">
              <span className={fieldLabelClassName}>Minimum rating</span>
              <Select
                value={settings.recommendations.minRating?.toString() ?? 'any'}
                onValueChange={(value) =>
                  setSettings((current) => ({
                    ...current,
                    recommendations: {
                      ...current.recommendations,
                      minRating: value === 'any' ? null : Number(value),
                    },
                  }))
                }
              >
                <SelectTrigger className="rounded-[14px] border-black/8 bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-[16px] border-black/8">
                  <SelectItem value="any">Any rating</SelectItem>
                  <SelectItem value="3">3.0+</SelectItem>
                  <SelectItem value="4">4.0+</SelectItem>
                  <SelectItem value="5">5.0 only</SelectItem>
                </SelectContent>
              </Select>
            </label>

            <label className="space-y-2 sm:col-span-2">
              <span className={fieldLabelClassName}>Audience</span>
              <Select
                value={settings.recommendations.audience}
                onValueChange={(value) =>
                  setSettings((current) => ({
                    ...current,
                    recommendations: {
                      ...current.recommendations,
                      audience: value as RecommendationAudiencePreference,
                    },
                  }))
                }
              >
                <SelectTrigger className="rounded-[14px] border-black/8 bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-[16px] border-black/8">
                  {AUDIENCE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          </div>
        </section>

        <section className={sectionClassName}>
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-full bg-[rgba(114,174,230,0.14)] text-[var(--color-text)]">
              <Map className="size-4" />
            </span>
            <div>
              <h2 className="text-[1rem] font-semibold tracking-[-0.02em] text-[var(--color-text)]">
                Map and display defaults
              </h2>
              <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                Choose what the planner map shows first.
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-4">
            <label className="flex items-center justify-between rounded-[16px] border border-black/8 bg-[var(--color-secondary-surface)] px-4 py-3">
              <div>
                <p className="text-sm font-medium text-[var(--color-text)]">
                  Show routes by default
                </p>
                <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                  Start planner map with route lines enabled.
                </p>
              </div>
              <Checkbox
                checked={settings.map.showRoutesByDefault}
                onCheckedChange={(checked) =>
                  setSettings((current) => ({
                    ...current,
                    map: {
                      ...current.map,
                      showRoutesByDefault: Boolean(checked),
                    },
                  }))
                }
              />
            </label>

            <label className="flex items-center justify-between rounded-[16px] border border-black/8 bg-[var(--color-secondary-surface)] px-4 py-3">
              <div>
                <p className="text-sm font-medium text-[var(--color-text)]">
                  Show custom layers by default
                </p>
                <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                  Keep saved map layers visible when the planner map opens.
                </p>
              </div>
              <Checkbox
                checked={settings.map.showCustomLayersByDefault}
                onCheckedChange={(checked) =>
                  setSettings((current) => ({
                    ...current,
                    map: {
                      ...current.map,
                      showCustomLayersByDefault: Boolean(checked),
                    },
                  }))
                }
              />
            </label>
          </div>
        </section>

        <section className={`${sectionClassName} xl:col-span-2`}>
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-full bg-[rgba(15,23,42,0.08)] text-[var(--color-text)]">
              <UserRound className="size-4" />
            </span>
            <div>
              <h2 className="text-[1rem] font-semibold tracking-[-0.02em] text-[var(--color-text)]">
                Account
              </h2>
              <p className="mt-1 text-sm text-[var(--color-text-muted)]">Update the identity.</p>
            </div>
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
            <div className="rounded-lg border border-black/5 bg-[var(--color-secondary-surface)] p-4">
              <p className={fieldLabelClassName}>Avatar</p>
              <div className="mt-4 flex flex-col items-center text-center">
                <Avatar className="size-24 rounded-xl border border-black/8 bg-white">
                  <AvatarImage src={avatarUrl} alt={displayName} />
                  <AvatarFallback className="rounded-xl text-lg font-semibold">
                    {getInitials(displayName)}
                  </AvatarFallback>
                </Avatar>
                <p className="mt-4 text-sm text-[var(--color-text-muted)]">JPG, PNG, or WebP.</p>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => avatarInputRef.current?.click()}
                  disabled={avatarBusy}
                >
                  <Camera className="size-4" />
                  {uploadAvatar.isPending ? 'Uploading…' : avatarUrl ? 'Replace' : 'Upload'}
                </Button>
                {avatarUrl ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => void handleAvatarRemove()}
                    disabled={avatarBusy}
                  >
                    {deleteAvatar.isPending ? 'Removing…' : 'Remove'}
                  </Button>
                ) : null}
              </div>

              <input
                ref={avatarInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => void handleAvatarInputChange(event)}
              />
            </div>

            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-2">
                  <span className={fieldLabelClassName}>First name</span>
                  <Input
                    value={account.firstName}
                    onChange={(event) =>
                      setAccount((current) => ({ ...current, firstName: event.target.value }))
                    }
                    placeholder="Voyager"
                  />
                </label>

                <label className="space-y-2">
                  <span className={fieldLabelClassName}>Last name</span>
                  <Input
                    value={account.lastName}
                    onChange={(event) =>
                      setAccount((current) => ({ ...current, lastName: event.target.value }))
                    }
                    placeholder="User"
                  />
                </label>
              </div>

              <div className="rounded-lg border border-black/5 bg-[var(--color-secondary-surface)] p-4">
                <p className={fieldLabelClassName}>Signed in as</p>
                <p className="mt-2 text-base font-medium text-[var(--color-text)]">{displayName}</p>
                <p className="mt-1 text-sm text-[var(--color-text-muted)]">{userEmail}</p>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => void handleSaveAccount()}
                  disabled={accountBusy || !accountDirty || isLoading}
                >
                  {patchAccount.isPending ? 'Saving…' : 'Save account'}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => auth.signoutRedirect()}
                  disabled={accountBusy}
                >
                  Sign out
                </Button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </WorkspacePage>
  );
}
