import { Link } from 'react-router-dom';
import type { PopularProductItem } from '../../../types';
import { ProductThumbnail } from '../../common/ProductThumbnail/ProductThumbnail';
import styles from './PopularProducts.module.scss';

export interface PopularProductsProps {
  products: PopularProductItem[];
}

export const PopularProducts = ({ products }: PopularProductsProps) => {
  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h2 className={styles.title}>Популярные товары</h2>
        <Link to="/warehouse" className={styles.actionLink}>
          Все товары
        </Link>
      </header>

      <ul className={styles.list}>
        {products.map((item) => (
          <li key={item.id} className={styles.item}>
            <span className={styles.rank}>{item.rank}</span>
            <ProductThumbnail type={item.iconType} size="md" />

            <div className={styles.meta}>
              <span className={styles.productName}>{item.name}</span>
              <span className={styles.categoryLabel}>{item.categoryLabel}</span>
            </div>

            <div className={styles.salesData}>
              <span className={styles.salesCount}>{item.salesCount} шт.</span>
              <span className={styles.revenueAmount}>
                {item.totalRevenue.toLocaleString('ru-RU')} сом
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};
