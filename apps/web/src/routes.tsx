import { createBrowserRouter } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { AdminRouteGuard } from "./components/AdminRouteGuard";
import { UserRouteGuard } from "./components/UserRouteGuard";
import { LibraryPage } from "./pages/LibraryPage";
import { ExerciseDetailPage } from "./pages/ExerciseDetailPage";
import { PracticePage } from "./pages/PracticePage";
import { HistoryPage } from "./pages/HistoryPage";
import { AdminPortalPage } from "./pages/AdminPortalPage";
import { AdminLibraryPage } from "./pages/AdminLibraryPage";
import { AdminTaskEditPage } from "./pages/AdminTaskEditPage";
import { AdminParseTaskPage } from "./pages/AdminParseTaskPage";
import { LoginPage } from "./pages/LoginPage";
import { ProfilePage } from "./pages/ProfilePage";
import { SettingsPage } from "./pages/SettingsPage";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <LibraryPage /> },
      { path: "tasks/:id", element: <ExerciseDetailPage /> },
      { path: "login", element: <LoginPage /> },
      {
        path: "practice/:taskId",
        element: (
          <UserRouteGuard>
            <PracticePage />
          </UserRouteGuard>
        )
      },
      {
        path: "history",
        element: (
          <UserRouteGuard>
            <HistoryPage />
          </UserRouteGuard>
        )
      },
      {
        path: "profile",
        element: (
          <UserRouteGuard>
            <ProfilePage />
          </UserRouteGuard>
        )
      },
      {
        path: "settings",
        element: (
          <UserRouteGuard>
            <SettingsPage />
          </UserRouteGuard>
        )
      },
      {
        path: "admin",
        element: (
          <AdminRouteGuard>
            <AdminPortalPage />
          </AdminRouteGuard>
        )
      },
      {
        path: "admin/library",
        element: (
          <AdminRouteGuard>
            <AdminLibraryPage />
          </AdminRouteGuard>
        )
      },
      {
        path: "admin/tasks/parse",
        element: (
          <AdminRouteGuard>
            <AdminParseTaskPage />
          </AdminRouteGuard>
        )
      },
      {
        path: "admin/tasks/:id",
        element: (
          <AdminRouteGuard>
            <AdminTaskEditPage />
          </AdminRouteGuard>
        )
      }
    ]
  }
]);
