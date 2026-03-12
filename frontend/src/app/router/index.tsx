import { createBrowserRouter, RouterProvider, Navigate, useParams } from 'react-router-dom'
import { RequireAuth } from '@/app/auth/RequireAuth'
import { ErrorBoundary } from 'react-error-boundary'
import { lazy, Suspense } from 'react'
import { config } from '@/app/config'
import { useDelayedLoading } from '@/shared/hooks/useDelayedLoading'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

// Public pages
const LandingPage = lazy(() => import('@/pages/public/landing'))
const ProductPage = lazy(() => import('@/pages/public/product'))
const HowItWorksPage = lazy(() => import('@/pages/public/how-it-works'))
const SignInPage = lazy(() => import('@/pages/public/signin'))
const AuthCallbackPage = lazy(() => import('@/pages/public/auth-callback'))
const AuthSilentPage = lazy(() => import('@/pages/public/auth-silent'))

// App pages
const SettingsPage = lazy(() => import('@/pages/app/settings'))
const TripsPage = lazy(() => import('@/pages/app/trips'))
const TripCreatePage = lazy(() => import('@/pages/app/trips/new'))
const PlanPage = lazy(() => import('@/pages/app/plan'))
const EventsPage = lazy(() => import('@/pages/app/events'))
const ProposalsPage = lazy(() => import('@/pages/app/proposals'))
const AppLayout = lazy(() => import('@/widgets/app-side-rail').then((m) => ({ default: m.AppLayout })))

function PageLoader() {
  const showLoading = useDelayedLoading(true, 250)
  
  if (!showLoading) return null

  return (
    <div className="voyager-page flex min-h-[100dvh] items-center justify-center animate-in fade-in duration-300">
      <div className="voyager-panel flex items-center gap-3 px-5 py-4 text-sm font-medium text-[var(--color-text-muted)]">
        <div className="size-5 rounded-full border-2 border-[var(--color-primary)] border-t-transparent animate-spin" />
        Loading workspace
      </div>
    </div>
  )
}

function RouteErrorFallback({ error, resetErrorBoundary }: { error: Error; resetErrorBoundary?: () => void }) {
  const traceId = (error as { traceId?: string }).traceId
  return (
    <div className="voyager-page flex min-h-[72dvh] items-center justify-center">
      <Card variant="solid" className="w-full max-w-2xl">
        <CardHeader className="gap-3">
          <span className="voyager-eyebrow w-fit">Route error</span>
          <CardTitle className="text-[2rem] md:text-[2.4rem]">Something went wrong</CardTitle>
          <CardDescription className="max-w-xl text-base">{error.message}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {traceId ? (
            <p className="rounded-[18px] border border-[var(--color-border-strong)] bg-white/72 px-4 py-3 font-mono text-xs text-[var(--color-text-muted)]">
              Trace: {traceId}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            {resetErrorBoundary ? (
              <Button onClick={resetErrorBoundary}>Retry</Button>
            ) : null}
            <Button asChild variant="outline">
              <a href="/">Return home</a>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export function FeatureRouteGate({
  enabled,
  children,
}: {
  enabled: boolean
  children: React.ReactNode
}) {
  const { tripId } = useParams<{ tripId: string }>()

  if (!enabled) {
    return <Navigate to={tripId ? `/app/trips/${tripId}` : '/app/trips'} replace />
  }

  return <>{children}</>
}

export function LegacyActivitiesRedirect() {
  const { tripId } = useParams<{ tripId: string }>()
  return <Navigate to={tripId ? `/app/trips/${tripId}/plan` : '/app/trips'} replace />
}

const router = createBrowserRouter([
  {
    path: '/',
    element: (
      <Suspense fallback={<PageLoader />}>
        <LandingPage />
      </Suspense>
    ),
  },
  {
    path: '/product',
    element: (
      <Suspense fallback={<PageLoader />}>
        <ProductPage />
      </Suspense>
    ),
  },
  {
    path: '/how-it-works',
    element: (
      <Suspense fallback={<PageLoader />}>
        <HowItWorksPage />
      </Suspense>
    ),
  },
  {
    path: '/signin',
    element: (
      <Suspense fallback={<PageLoader />}>
        <SignInPage />
      </Suspense>
    ),
  },
  {
    path: '/auth/callback',
    element: (
      <Suspense fallback={<PageLoader />}>
        <AuthCallbackPage />
      </Suspense>
    ),
  },
  {
    path: '/auth/silent',
    element: (
      <Suspense fallback={null}>
        <AuthSilentPage />
      </Suspense>
    ),
  },
  {
    path: '/app',
    element: (
      <RequireAuth>
        <ErrorBoundary FallbackComponent={RouteErrorFallback}>
          <Suspense fallback={<PageLoader />}>
            <AppLayout />
          </Suspense>
        </ErrorBoundary>
      </RequireAuth>
    ),
    children: [
      { index: true, element: <Navigate to="trips" replace /> },
      {
        path: 'settings',
        element: (
          <Suspense fallback={<PageLoader />}>
            <SettingsPage />
          </Suspense>
        ),
      },
      {
        path: 'trips',
        element: (
          <Suspense fallback={<PageLoader />}>
            <TripsPage />
          </Suspense>
        ),
      },
      {
        path: 'trips/new',
        element: (
          <Suspense fallback={<PageLoader />}>
            <TripCreatePage />
          </Suspense>
        ),
      },
      {
        path: 'trips/:tripId',
        element: <Navigate to="plan" replace />,
      },
      {
        path: 'trips/:tripId/plan',
        element: (
          <Suspense fallback={<PageLoader />}>
            <PlanPage />
          </Suspense>
        ),
      },
      {
        path: 'trips/:tripId/map',
        element: <Navigate to="../plan" replace />,
      },
      {
        path: 'trips/:tripId/activities',
        element: <LegacyActivitiesRedirect />,
      },
      {
        path: 'trips/:tripId/events',
        element: (
          <FeatureRouteGate enabled={config.features.activitiesUI}>
            <ErrorBoundary FallbackComponent={RouteErrorFallback}>
              <Suspense fallback={<PageLoader />}>
                <EventsPage />
              </Suspense>
            </ErrorBoundary>
          </FeatureRouteGate>
        ),
      },
      {
        path: 'trips/:tripId/proposals',
        element: (
          <FeatureRouteGate enabled={config.features.activitiesUI}>
            <ErrorBoundary FallbackComponent={RouteErrorFallback}>
              <Suspense fallback={<PageLoader />}>
                <ProposalsPage />
              </Suspense>
            </ErrorBoundary>
          </FeatureRouteGate>
        ),
      },
    ],
  },
  {
    path: '*',
    element: (
      <div className="voyager-page flex min-h-[100dvh] items-center justify-center">
        <Card variant="solid" className="w-full max-w-xl text-center">
          <CardHeader className="items-center gap-3">
            <span className="voyager-eyebrow">404</span>
            <CardTitle className="text-[2.5rem] md:text-[3rem]">Page not found</CardTitle>
            <CardDescription className="text-base">
              This route does not exist or is no longer available.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center">
            <Button asChild>
              <a href="/">Go home</a>
            </Button>
          </CardContent>
        </Card>
      </div>
    ),
  },
])

export function Router() {
  return <RouterProvider router={router} />
}
