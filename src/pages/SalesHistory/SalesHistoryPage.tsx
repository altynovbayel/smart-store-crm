import { Clock } from 'lucide-react';
import { PagePlaceholder } from '../../components/common/PagePlaceholder/PagePlaceholder';

export const SalesHistoryPage = () => {
  return (
    <PagePlaceholder
      title="История продаж"
      subtitle="Журнал фискальных чеков, детальная информация по транзакциям и фильтры по датам."
      icon={<Clock size={32} />}
    />
  );
};
