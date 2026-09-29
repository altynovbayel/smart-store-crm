import { ArrowDownToLine } from 'lucide-react';
import { PagePlaceholder } from '../../components/common/PagePlaceholder/PagePlaceholder';

export const IncomePage = () => {
  return (
    <PagePlaceholder
      title="Приход товаров"
      subtitle="Учёт поступлений новых партий мобильных аксессуаров от поставщиков на склад."
      icon={<ArrowDownToLine size={32} />}
    />
  );
};
