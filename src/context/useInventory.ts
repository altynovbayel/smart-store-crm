import { useContext } from 'react';
import { InventoryContext } from './InventoryContext';
import type { InventoryContextValue } from './InventoryContext';

export const useInventory = (): InventoryContextValue => {
  const context = useContext(InventoryContext);
  if (!context) {
    throw new Error('useInventory must be used within an InventoryProvider');
  }
  return context;
};
