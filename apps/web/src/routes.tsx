import { createBrowserRouter } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { LibraryPage } from "./pages/LibraryPage";
import { ExerciseDetailPage } from "./pages/ExerciseDetailPage";
import { PracticePage } from "./pages/PracticePage";
import { HistoryPage } from "./pages/HistoryPage";
import { AdminLibraryPage } from "./pages/AdminLibraryPage";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <LibraryPage /> },
      { path: "exercises/:id", element: <ExerciseDetailPage /> },
      { path: "practice/:id", element: <PracticePage /> },
      { path: "history", element: <HistoryPage /> },
      { path: "admin/library", element: <AdminLibraryPage /> }
    ]
  }
]);
