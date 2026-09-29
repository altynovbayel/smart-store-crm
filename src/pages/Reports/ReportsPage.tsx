import { BarChart3 } from 'lucide-react';
import { PagePlaceholder } from '../../components/common/PagePlaceholder/PagePlaceholder';

export const ReportsPage = () => {
  return (
    <PagePlaceholder
      title="Отчёты и аналитика"
      subtitle="Финансовые показатели, маржинальность, отчёты по категориям товаров и оборачиваемости."
      icon={<BarChart3 size={32} />}
    />
  );
};
