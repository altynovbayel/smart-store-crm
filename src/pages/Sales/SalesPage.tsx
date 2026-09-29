import { ShoppingCart } from 'lucide-react';
import { PagePlaceholder } from '../../components/common/PagePlaceholder/PagePlaceholder';

export const SalesPage = () => {
  return (
    <PagePlaceholder
      title="Продажи"
      subtitle="Оформление новых продаж аксессуаров, выбор товаров из каталога и добавление в чек."
      icon={<ShoppingCart size={32} />}
    />
  );
};
