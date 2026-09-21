import { lazy, Suspense } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import ProtectedRoute from "./components/ProtectedRoute";
import OpenProductPage from "./pages/OpenProductPage";

const BillingPage = lazy(() => import("./pages/BillingPage"));
const BillingOrderPage = lazy(() => import("./pages/BillingOrderPage"));
const BillingHistoryPage = lazy(() =>
  import("./pages/BillingOrderPage").then((m) => ({
    default: m.BillingHistoryPage,
  })),
);
const BillingAdminPage = lazy(() => import("./pages/BillingAdminPage"));
function App() {
  return (
    <Suspense
      fallback={
        <main className="p-8" role="status">
          Loading…
        </main>
      }
    >
      <Routes>
        <Route
          path="/billing/history"
          element={
            <ProtectedRoute>
              <BillingHistoryPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/billing/orders/:id"
          element={
            <ProtectedRoute>
              <BillingOrderPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/billing/manage/:product"
          element={
            <ProtectedRoute>
              <BillingAdminPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/billing/:product"
          element={
            <ProtectedRoute>
              <BillingPage />
            </ProtectedRoute>
          }
        />
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/open/:product"
          element={
            <ProtectedRoute>
              <OpenProductPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <DashboardPage />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

export default App;
