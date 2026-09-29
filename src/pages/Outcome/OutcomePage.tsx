import { ArrowUpFromLine } from 'lucide-react';
import { PagePlaceholder } from '../../components/common/PagePlaceholder/PagePlaceholder';

export const OutcomePage = () => {
  return (
    <PagePlaceholder
      title="Расход товаров"
      subtitle="Списание брака, перемещения между витринами и учёт внутренних расходов магазина."
      icon={<ArrowUpFromLine size={32} />}
    />
  );
};
