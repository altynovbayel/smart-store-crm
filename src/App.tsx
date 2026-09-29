  import { RouterProvider } from 'react-router-dom';
import { router } from './router';
import { InventoryProvider } from './context';

export function App() {
  return (
    <InventoryProvider>
      <RouterProvider router={router} />
    </InventoryProvider>
  );
}

export default App;
