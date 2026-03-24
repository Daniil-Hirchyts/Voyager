import { createBrowserRouter, RouterProvider, Navigate, Outlet, useParams } from 'react-router-dom';
import { RequireAuth } from '@/app/auth/RequireAuth';
import { ErrorBoundary } from 'react-error-boundary';
import { lazy, Suspense } from 'react';
import { useDelayedLoading } from '@/shared/hooks/useDelayedLoading';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { VoyagerLoader } from '@/widgets/app-shell/logo';

const LandingPage = lazy(() => import('@/pages/public/landing'));
const SignInPage = lazy(() => import('@/pages/public/signin'));
const AuthCallbackPage = lazy(() => import('@/pages/public/auth-callback'));
const AuthSilentPage = lazy(() => import('@/pages/public/auth-silent'));
const PrivacyPolicyPage = lazy(() => import('@/pages/public/privacy'));
const TermsOfServicePage = lazy(() => import('@/pages/public/terms'));
const CookiePolicyPage = lazy(() => import('@/pages/public/cookies'));

const SettingsPage = lazy(() => import('@/pages/app/settings'));
const TripsPage = lazy(() => import('@/pages/app/trips'));
const TripCreatePage = lazy(() => import('@/pages/app/trips/new'));
const TripInvitePage = lazy(() => import('@/pages/app/invites'));
const PlanPage = lazy(() => import('@/pages/app/plan'));
const AppLayout = lazy(() =>
  import('@/widgets/app-side-rail').then((m) => ({ default: m.AppLayout })),
);

function PageLoader() {
  const showLoading = useDelayedLoading(true, 250);
  if (!showLoading) return null;

  return (
    <div className="voyager-page flex min-h-[100dvh] items-center justify-center">
      <div className="voyager-panel flex items-center gap-3 px-5 py-4 text-sm font-medium text-[var(--color-text-muted)]">
        <VoyagerLoader className="size-5 text-[var(--color-accent-blue)]" />
        Loading workspace
      </div>
    </div>
  );
}

function RouteErrorFallback({
  error,
  resetErrorBoundary,
}: {
  error: Error;
  resetErrorBoundary?: () => void;
}) {
  const traceId = (error as { traceId?: string }).traceId;
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
            {resetErrorBoundary ? <Button onClick={resetErrorBoundary}>Retry</Button> : null}
            <Button asChild variant="outline">
              <a href="/">Return home</a>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function LegacyActivitiesRedirect() {
  const { tripId } = useParams<{ tripId: string }>();
  return <Navigate to={tripId ? `/app/trips/${tripId}/plan` : '/app/trips'} replace />;
}

const router = createBrowserRouter([
  {
    element: <Outlet />,
    children: [
      {
        index: true,
        element: (
          <Suspense fallback={<PageLoader />}>
            <LandingPage />
          </Suspense>
        ),
      },
      {
        path: 'signin',
        element: (
          <Suspense fallback={<PageLoader />}>
            <SignInPage />
          </Suspense>
        ),
      },
      {
        path: 'auth/callback',
        element: (
          <Suspense fallback={<PageLoader />}>
            <AuthCallbackPage />
          </Suspense>
        ),
      },
      {
        path: 'privacy',
        element: (
          <Suspense fallback={<PageLoader />}>
            <PrivacyPolicyPage />
          </Suspense>
        ),
      },
      {
        path: 'terms',
        element: (
          <Suspense fallback={<PageLoader />}>
            <TermsOfServicePage />
          </Suspense>
        ),
      },
      {
        path: 'cookies',
        element: (
          <Suspense fallback={<PageLoader />}>
            <CookiePolicyPage />
          </Suspense>
        ),
      },
    ],
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
        path: 'invites/:token',
        element: (
          <Suspense fallback={<PageLoader />}>
            <TripInvitePage />
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
]);

export function Router() {
  return <RouterProvider router={router} future={{ v7_startTransition: true }} />;
}
