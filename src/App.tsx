import { RouterProvider } from 'react-router-dom';
import { router } from './router';
import { AuthProvider, InventoryProvider } from './context';

export function App() {
  return (
    <AuthProvider>
      <InventoryProvider>
        <RouterProvider router={router} />
      </InventoryProvider>
    </AuthProvider>
  );
}

export default App;
