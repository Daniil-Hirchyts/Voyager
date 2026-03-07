import { createBrowserRouter, RouterProvider, Navigate, useParams } from 'react-router-dom'
import { RequireAuth } from '@/features/auth/RequireAuth'
import { ErrorBoundary } from 'react-error-boundary'
import { lazy, Suspense } from 'react'
import { config } from '@/app/config'
import { useDelayedLoading } from '@/shared/hooks/useDelayedLoading'

// Public pages
const LandingPage = lazy(() => import('@/pages/public/landing'))
const ProductPage = lazy(() => import('@/pages/public/product'))
const HowItWorksPage = lazy(() => import('@/pages/public/how-it-works'))
const SignInPage = lazy(() => import('@/pages/public/signin'))
const AuthCallbackPage = lazy(() => import('@/pages/public/auth-callback'))

// App pages
const AppShell = lazy(() => import('@/widgets/app-shell'))
const TripsPage = lazy(() => import('@/pages/app/trips'))
const TripCreatePage = lazy(() => import('@/pages/app/trips/new'))
const TripDetailPage = lazy(() => import('@/pages/app/trip-detail'))
const PlanPage = lazy(() => import('@/pages/app/plan'))
const MapPage = lazy(() => import('@/pages/app/map'))
const OffersPage = lazy(() => import('@/pages/app/offers'))
const ExportsPage = lazy(() => import('@/pages/app/exports'))
const AuditPage = lazy(() => import('@/pages/app/audit'))
const EventsPage = lazy(() => import('@/pages/app/events'))
const ProposalsPage = lazy(() => import('@/pages/app/proposals'))

function PageLoader() {
  const showLoading = useDelayedLoading(true, 250)
  
  if (!showLoading) return null

  return (
    <div
      className="flex items-center justify-center min-h-screen animate-in fade-in duration-300"
      style={{ background: 'var(--color-bg)' }}
    >
      <div className="w-6 h-6 border-2 border-[#2F6F73] border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

function RouteErrorFallback({ error, resetErrorBoundary }: { error: Error; resetErrorBoundary?: () => void }) {
  const traceId = (error as { traceId?: string }).traceId
  return (
    <div
      className="flex flex-col items-center justify-center min-h-[60vh] gap-4 p-8"
      style={{ background: 'var(--color-bg)' }}
    >
      <h1 className="font-display text-3xl text-[#1D2430]">Something went wrong</h1>
      <p className="text-[#526072] max-w-md text-center">{error.message}</p>
      {traceId && (
        <p className="text-xs text-[#526072]/60 font-mono">Trace: {traceId}</p>
      )}
      <div className="flex items-center gap-3">
        {resetErrorBoundary && (
          <button
            onClick={resetErrorBoundary}
            className="px-5 py-2.5 bg-[#2F6F73] text-white rounded-[10px] text-sm font-medium hover:bg-[#266063] transition-colors"
          >
            Retry
          </button>
        )}
        <button
          onClick={() => (window.location.href = '/')}
          className="px-5 py-2.5 border text-[#526072] rounded-[10px] text-sm font-medium hover:bg-[#F4EBDD] transition-colors"
          style={{ borderColor: 'var(--color-border)' }}
        >
          Return Home
        </button>
      </div>
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
    path: '/app',
    element: (
      <RequireAuth>
        <ErrorBoundary FallbackComponent={RouteErrorFallback}>
          <Suspense fallback={<PageLoader />}>
            <AppShell />
          </Suspense>
        </ErrorBoundary>
      </RequireAuth>
    ),
    children: [
      { index: true, element: <Navigate to="trips" replace /> },
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
        element: (
          <Suspense fallback={<PageLoader />}>
            <TripDetailPage />
          </Suspense>
        ),
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
        element: (
          <FeatureRouteGate enabled={config.features.mapUI}>
            <Suspense fallback={<PageLoader />}>
              <MapPage />
            </Suspense>
          </FeatureRouteGate>
        ),
      },
      {
        path: 'trips/:tripId/offers',
        element: (
          <FeatureRouteGate enabled={config.features.offersUI}>
            <Suspense fallback={<PageLoader />}>
              <OffersPage />
            </Suspense>
          </FeatureRouteGate>
        ),
      },
      {
        path: 'trips/:tripId/exports',
        element: (
          <FeatureRouteGate enabled={config.features.exportsUI}>
            <ErrorBoundary FallbackComponent={RouteErrorFallback}>
              <Suspense fallback={<PageLoader />}>
                <ExportsPage />
              </Suspense>
            </ErrorBoundary>
          </FeatureRouteGate>
        ),
      },
      {
        path: 'trips/:tripId/audit',
        element: (
          <FeatureRouteGate enabled={config.features.auditUI}>
            <ErrorBoundary FallbackComponent={RouteErrorFallback}>
              <Suspense fallback={<PageLoader />}>
                <AuditPage />
              </Suspense>
            </ErrorBoundary>
          </FeatureRouteGate>
        ),
      },
      {
        path: 'trips/:tripId/events',
        element: (
          <FeatureRouteGate enabled={config.features.eventsUI}>
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
          <FeatureRouteGate enabled={config.features.proposalsUI}>
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
      <div
        className="flex flex-col items-center justify-center min-h-screen gap-4"
        style={{ background: 'var(--color-bg)' }}
      >
        <h1 className="font-display text-6xl text-[#1D2430]">404</h1>
        <p className="text-[#526072]">Page not found</p>
        <a href="/" className="text-[#2F6F73] underline text-sm">
          Go home
        </a>
      </div>
    ),
  },
])

export function Router() {
  return <RouterProvider router={router} />
}
