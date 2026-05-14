import { createBrowserRouter, RouterProvider } from 'react-router-dom';

import { AppLayout } from './AppLayout';
import { LoginPage } from '@/pages/Login';
import { HomePage } from '@/pages/Home';
import { DayPage } from '@/pages/DayPage';
import { ReportsPage } from '@/pages/Reports';
import { SettingsPage } from '@/pages/Settings';

const router = createBrowserRouter([
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'day/:date', element: <DayPage /> },
      { path: 'reports', element: <ReportsPage /> },
      { path: 'settings', element: <SettingsPage /> },
    ],
  },
]);

export function AppRouter() {
  return <RouterProvider router={router} />;
}
