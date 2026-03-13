import { useEffect, useState } from 'react'
import { useAuth } from 'react-oidc-context'
import { Globe2, Map, Settings2, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  DEFAULT_VOYAGER_PREFERENCES,
  mergeVoyagerPreferences,
  readVoyagerPreferences,
  type RecommendationAudiencePreference,
} from '@/entities/user/preferences'
import { usePatchProfile, useProfile } from '@/entities/user/queries'
import { CURRENCY_OPTIONS } from '@/shared/lib/currencies'
import {
  WorkspaceHeader,
  WorkspacePage,
} from '@/shared/layouts/workspace-shell'

const sectionClassName =
  'rounded-[20px] border border-black/8 bg-white p-5 shadow-[0_22px_60px_-44px_rgba(15,23,42,0.22)]'
const fieldLabelClassName =
  'text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-[var(--color-text-muted)]'

const AUDIENCE_OPTIONS: Array<{
  value: RecommendationAudiencePreference
  label: string
}> = [
  { value: 'any', label: 'Any traveler' },
  { value: 'families', label: 'Families' },
  { value: 'couples', label: 'Couples' },
  { value: 'friends', label: 'Friends' },
  { value: 'solo_travelers', label: 'Solo travelers' },
]

const LOCALE_OPTIONS = ['en-US', 'fr-FR', 'it-IT', 'de-DE', 'es-ES']

export default function SettingsPage() {
  const auth = useAuth()
  const { data: profile, isLoading } = useProfile()
  const patchProfile = usePatchProfile()
  const [settings, setSettings] = useState(DEFAULT_VOYAGER_PREFERENCES)

  useEffect(() => {
    if (!profile) {
      return
    }
    setSettings(readVoyagerPreferences(profile))
  }, [profile])

  async function handleSave() {
    if (!profile) {
      return
    }

    try {
      await patchProfile.mutateAsync({
        preferences: mergeVoyagerPreferences(profile.preferences, settings),
      })
      toast.success('App settings saved')
    } catch {
      toast.error('Could not save app settings')
    }
  }

  return (
    <WorkspacePage className="gap-4">
      <WorkspaceHeader
        eyebrow="Settings"
        title="App defaults"
        description="Set the recommendation, map, and regional defaults Voyager should use across trips."
        actions={(
          <Button onClick={() => void handleSave()} disabled={patchProfile.isPending || isLoading}>
            {patchProfile.isPending ? 'Saving…' : 'Save settings'}
          </Button>
        )}
      />

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
                <SelectTrigger className="rounded-[14px] border-black/8 bg-white shadow-none">
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
                <SelectTrigger className="rounded-[14px] border-black/8 bg-white shadow-none">
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
                <p className="text-sm font-medium text-[var(--color-text)]">Show routes by default</p>
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
                <p className="text-sm font-medium text-[var(--color-text)]">Show custom layers by default</p>
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

        <section className={sectionClassName}>
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-full bg-[rgba(34,197,94,0.14)] text-[var(--color-text)]">
              <Globe2 className="size-4" />
            </span>
            <div>
              <h2 className="text-[1rem] font-semibold tracking-[-0.02em] text-[var(--color-text)]">
                Regional defaults
              </h2>
              <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                Locale and currency used for recommendations and display formatting.
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="space-y-2">
              <span className={fieldLabelClassName}>Locale</span>
              <Select
                value={settings.regional.locale}
                onValueChange={(value) =>
                  setSettings((current) => ({
                    ...current,
                    regional: {
                      ...current.regional,
                      locale: value,
                    },
                  }))
                }
              >
                <SelectTrigger className="rounded-[14px] border-black/8 bg-white shadow-none">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-[16px] border-black/8">
                  {LOCALE_OPTIONS.map((locale) => (
                    <SelectItem key={locale} value={locale}>
                      {locale}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>

            <label className="space-y-2">
              <span className={fieldLabelClassName}>Currency</span>
              <Select
                value={settings.regional.currency}
                onValueChange={(value) =>
                  setSettings((current) => ({
                    ...current,
                    regional: {
                      ...current.regional,
                      currency: value,
                    },
                  }))
                }
              >
                <SelectTrigger className="rounded-[14px] border-black/8 bg-white shadow-none">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-64 rounded-[16px] border-black/8">
                  {CURRENCY_OPTIONS.map((currency) => (
                    <SelectItem key={currency.value} value={currency.value}>
                      {currency.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          </div>
        </section>

        <section className={sectionClassName}>
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-full bg-[rgba(15,23,42,0.08)] text-[var(--color-text)]">
              <Settings2 className="size-4" />
            </span>
            <div>
              <h2 className="text-[1rem] font-semibold tracking-[-0.02em] text-[var(--color-text)]">
                Account
              </h2>
              <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                Signed-in profile details and session controls.
              </p>
            </div>
          </div>

          <div className="mt-5 rounded-[18px] border border-black/8 bg-[var(--color-secondary-surface)] p-4">
            <p className={fieldLabelClassName}>Signed in as</p>
            <p className="mt-2 text-base font-medium text-[var(--color-text)]">
              {(auth.user?.profile?.name as string | undefined) || 'Traveler'}
            </p>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              {(auth.user?.profile?.email as string | undefined) ||
                profile?.keycloak_sub ||
                'Signed in'}
            </p>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => auth.signoutRedirect()}>
              Sign out
            </Button>
          </div>
        </section>
      </div>
    </WorkspacePage>
  )
}
