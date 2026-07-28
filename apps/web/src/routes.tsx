import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, createBrowserRouter } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { AdminRouteGuard } from "./components/AdminRouteGuard";
import { LocalizedText } from "./components/LocalizedText";
import { UserRouteGuard } from "./components/UserRouteGuard";

const LibraryPage = lazy(() =>
  import("./pages/LibraryPage").then((module) => ({
    default: module.LibraryPage,
  })),
);
const ExerciseDetailPage = lazy(() =>
  import("./pages/ExerciseDetailPage").then((module) => ({
    default: module.ExerciseDetailPage,
  })),
);
const PracticePage = lazy(() =>
  import("./pages/PracticePage").then((module) => ({
    default: module.PracticePage,
  })),
);
const MinigamePlayPage = lazy(() =>
  import("./pages/MinigamesPage").then((module) => ({
    default: module.MinigamePlayPage,
  })),
);
const MinigameHubPage = lazy(() =>
  import("./pages/MinigameHubPage").then((module) => ({
    default: module.MinigameHubPage,
  })),
);
const MinigameSessionDetailPage = lazy(() =>
  import("./pages/MinigameSessionDetailPage").then((module) => ({
    default: module.MinigameSessionDetailPage,
  })),
);
const HistoryPage = lazy(() =>
  import("./pages/HistoryPage").then((module) => ({
    default: module.HistoryPage,
  })),
);
const AdminPortalPage = lazy(() =>
  import("./pages/AdminPortalPage").then((module) => ({
    default: module.AdminPortalPage,
  })),
);
const AdminLibraryPage = lazy(() =>
  import("./pages/AdminLibraryPage").then((module) => ({
    default: module.AdminLibraryPage,
  })),
);
const AdminTaskEditPage = lazy(() =>
  import("./pages/AdminTaskEditPage").then((module) => ({
    default: module.AdminTaskEditPage,
  })),
);
const AdminParseTaskPage = lazy(() =>
  import("./pages/AdminParseTaskPage").then((module) => ({
    default: module.AdminParseTaskPage,
  })),
);
const LoginPage = lazy(() =>
  import("./pages/LoginPage").then((module) => ({ default: module.LoginPage })),
);
const ProfilePage = lazy(() =>
  import("./pages/ProfilePage").then((module) => ({
    default: module.ProfilePage,
  })),
);
const PublicProfilePage = lazy(() =>
  import("./pages/PublicProfilePage").then((module) => ({
    default: module.PublicProfilePage,
  })),
);
const SettingsPage = lazy(() =>
  import("./pages/SettingsPage").then((module) => ({
    default: module.SettingsPage,
  })),
);
const LeaderboardPage = lazy(() =>
  import("./pages/LeaderboardPage").then((module) => ({
    default: module.LeaderboardPage,
  })),
);
const HelpLayout = lazy(() =>
  import("./pages/help/HelpLayout").then((module) => ({
    default: module.HelpLayout,
  })),
);
const GettingStarted = lazy(() =>
  import("./pages/help/pages/GettingStarted").then((module) => ({
    default: module.GettingStarted,
  })),
);
const HowItWorks = lazy(() =>
  import("./pages/help/pages/HowItWorks").then((module) => ({
    default: module.HowItWorks,
  })),
);
const DeliberatePractice = lazy(() =>
  import("./pages/help/pages/DeliberatePractice").then((module) => ({
    default: module.DeliberatePractice,
  })),
);
const About = lazy(() =>
  import("./pages/help/pages/About").then((module) => ({
    default: module.About,
  })),
);
const LocalSuite = lazy(() =>
  import("./pages/help/pages/LocalSuite").then((module) => ({
    default: module.LocalSuite,
  })),
);

const RouteLoading = () => (
  <div
    className="mx-auto flex min-h-[40vh] max-w-6xl items-center justify-center px-6 text-slate-300"
    role="status"
    aria-live="polite"
  >
    <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-600 border-t-teal-300" />
    <span className="ml-3 text-sm font-medium">
      <LocalizedText i18nKey="route.loading" />
    </span>
  </div>
);

const loadRoute = (content: ReactNode) => (
  <Suspense fallback={<RouteLoading />}>{content}</Suspense>
);

export const router = createBrowserRouter([
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: loadRoute(<LibraryPage />) },
      { path: "tasks/:id", element: loadRoute(<ExerciseDetailPage />) },
      { path: "login", element: loadRoute(<LoginPage />) },
      {
        path: "practice/:taskId",
        element: loadRoute(
          <UserRouteGuard>
            <PracticePage />
          </UserRouteGuard>,
        ),
      },
      {
        path: "minigames",
        element: loadRoute(
          <UserRouteGuard>
            <MinigameHubPage />
          </UserRouteGuard>,
        ),
      },
      {
        path: "minigames/play",
        element: loadRoute(
          <UserRouteGuard>
            <MinigamePlayPage />
          </UserRouteGuard>,
        ),
      },
      {
        path: "minigames/play/:sessionId",
        element: loadRoute(
          <UserRouteGuard>
            <MinigamePlayPage />
          </UserRouteGuard>,
        ),
      },
      {
        path: "minigames/session/:sessionId",
        element: loadRoute(
          <UserRouteGuard>
            <MinigameSessionDetailPage />
          </UserRouteGuard>,
        ),
      },
      {
        path: "history",
        element: loadRoute(
          <UserRouteGuard>
            <HistoryPage />
          </UserRouteGuard>,
        ),
      },
      {
        path: "leaderboard",
        element: loadRoute(
          <UserRouteGuard>
            <LeaderboardPage />
          </UserRouteGuard>,
        ),
      },
      {
        path: "profile",
        element: loadRoute(
          <UserRouteGuard>
            <ProfilePage />
          </UserRouteGuard>,
        ),
      },
      {
        path: "profiles/:id",
        element: loadRoute(
          <UserRouteGuard>
            <PublicProfilePage />
          </UserRouteGuard>,
        ),
      },
      {
        path: "settings",
        element: loadRoute(
          <UserRouteGuard>
            <SettingsPage />
          </UserRouteGuard>,
        ),
      },
      {
        path: "admin",
        element: loadRoute(
          <AdminRouteGuard>
            <AdminPortalPage />
          </AdminRouteGuard>,
        ),
      },
      {
        path: "admin/library",
        element: loadRoute(
          <AdminRouteGuard>
            <AdminLibraryPage />
          </AdminRouteGuard>,
        ),
      },
      {
        path: "admin/tasks/parse",
        element: loadRoute(
          <AdminRouteGuard>
            <AdminParseTaskPage />
          </AdminRouteGuard>,
        ),
      },
      {
        path: "admin/tasks/:id",
        element: loadRoute(
          <AdminRouteGuard>
            <AdminTaskEditPage />
          </AdminRouteGuard>,
        ),
      },
      {
        path: "help",
        element: loadRoute(<HelpLayout />),
        children: [
          { index: true, element: <Navigate to="getting-started" replace /> },
          { path: "getting-started", element: loadRoute(<GettingStarted />) },
          { path: "how-it-works", element: loadRoute(<HowItWorks />) },
          {
            path: "deliberate-practice",
            element: loadRoute(<DeliberatePractice />),
          },
          { path: "about", element: loadRoute(<About />) },
          { path: "local-suite", element: loadRoute(<LocalSuite />) },
        ],
      },
    ],
  },
]);
