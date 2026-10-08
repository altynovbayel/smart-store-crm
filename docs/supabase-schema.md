# Архитектура базы данных Supabase (Smart Store CRM)

Документ описывает структуру схемы PostgreSQL, модель данных, безопасность и правила взаимодействия с базой данных Supabase для **CRM Smart Store**.

---

## 1. Общие принципы и архитектурные решения

1. **Один магазин (Single Store):** архитектура рассчитана на розничный магазин аксессуаров и мобильной техники без multi-tenant усложнений.
2. **Чистый старт рабочей базы:** рабочая база данных разворачивается с нуля. Демонстрационные данные фронтенда в Supabase не переносятся.
3. **Строгая типизация денег и процентов:**
   - Все денежные значения хранятся в **целых тыйынах** (`bigint`, суффикс `_minor`, 1 сом = 100 тыйынов).
   - Дробные типы (`float`, `real`, `double precision`) для денег строго запрещены.
   - Максимальный лимит цены единицы товара: **100 000 000 сом = 10 000 000 000 тыйынов**.
   - Проценты хранятся в **basis points** (`bigint`): `10000 = 100.00%`, `250 = 2.50%`.
4. **Неизменяемость проведённых документов (Accounting Immutability):**
   - Проведённые чеки, накладные прихода, акты списания и складские движения неизменяемы и не подлежат физическому удалению через frontend.
   - Исторические строки документов хранят полные **snapshot-поля** (название, SKU, закупочную и розничную цену на момент совершения операции), что гарантирует неизменность исторических отчётов и прибыли даже при последующем редактировании каталога товаров.
5. **Защита от прямых мутаций (RPC-only Mutex):**
   - На уровне прав и RLS пользователям роли `authenticated` предоставлен только доступ `SELECT`.
   - Прямые `INSERT`, `UPDATE`, `DELETE` для бизнес-таблиц закрыты как на уровне `GRANT/REVOKE`, так и на уровне RLS-политик.
   - На следующем этапе все мутации будут выполняться исключительно через транзакционные RPC-функции (`SECURITY DEFINER`), гарантирующие атомарное обновление складских остатков и создание движений.

---

## 2. PostgreSQL Enum-типы

| Enum | Значения | Назначение |
|---|---|---|
| `public.app_role` | `'admin'`, `'cashier'` | Ролевая модель сотрудников магазина |
| `public.payment_method` | `'cash'`, `'card'`, `'transfer'` | Способы оплаты чека |
| `public.discount_type` | `'none'`, `'fixed'`, `'percent'` | Тип скидки (на позицию или на чек) |
| `public.movement_type` | `'opening_balance'`, `'income'`, `'sale'`, `'write_off'`, `'inventory_adjustment'` | Тип складского движения |
| `public.outcome_reason` | `'damaged'`, `'defective'`, `'lost'`, `'internal_use'`, `'other'` | Причина списания товара |
| `public.document_status` | `'completed'` | Статус проведённого документа |

---

## 3. Таблицы и структура данных

### 3.1. `public.profiles` (Профили сотрудников)
Связана 1-к-1 с `auth.users(id)`.
- `id` (uuid, PK, references `auth.users(id)` on delete cascade)
- `full_name` (text, not null, non-empty)
- `role` (app_role, not null, default `'cashier'`)
- `is_active` (boolean, not null, default `false` — требует одобрения администратором)
- `created_at` (timestamptz, default `now()`)
- `updated_at` (timestamptz, default `now()`)

### 3.2. `public.products` (Каталог товаров)
- `id` (uuid, PK, default `gen_random_uuid()`)
- `sku` (text, not null, unique case-insensitive)
- `barcode` (text, not null, unique trimmed)
- `name` (text, not null)
- `category` (text, not null, e.g. `'cases'`, `'cables'`)
- `category_label` (text, not null)
- `description` (text)
- `purchase_price_minor` (bigint, not null, >= 0)
- `selling_price_minor` (bigint, not null, >= purchase_price_minor)
- `stock` (integer, not null, default `0`, range 0..100_000_000)
- `min_stock_threshold` (integer, not null, default `0`)
- `is_archived` (boolean, not null, default `false`)
- `created_by` (uuid, references `profiles(id)`)
- `updated_by` (uuid, references `profiles(id)`)
- `created_at` (timestamptz, default `now()`)
- `updated_at` (timestamptz, default `now()`)

### 3.3. `public.sales` и `public.sale_items` (Продажи и позиции чеков)
**`public.sales`:**
- `id` (uuid, PK)
- `receipt_number` (text, unique)
- `sold_at` (timestamptz, not null)
- `payment_method` (payment_method, not null)
- `subtotal_minor` (bigint, not null)
- `item_discount_total_minor` (bigint, not null)
- `receipt_discount_type` (discount_type, not null)
- `receipt_discount_value` (bigint, not null)
- `receipt_discount_minor` (bigint, not null)
- `total_discount_minor` (bigint, not null)
- `total_minor` (bigint, not null)
- `received_minor` (bigint, required for cash)
- `change_minor` (bigint, required for cash)
- `profit_minor` (bigint, not null)
- `status` (document_status, default `'completed'`)
- `comment` (text)
- `created_by` (uuid, references `profiles(id)`)
- `created_by_name` (text, not null)
- `created_at` (timestamptz, default `now()`)

**`public.sale_items`:**
- `id` (uuid, PK)
- `sale_id` (uuid, references `sales(id)` on delete restrict)
- `product_id` (uuid, references `products(id)` on delete restrict)
- `product_name_snapshot` (text, not null)
- `sku_snapshot` (text, not null)
- `barcode_snapshot` (text)
- `quantity` (integer, not null, > 0)
- `purchase_price_snapshot_minor` (bigint, not null)
- `selling_price_snapshot_minor` (bigint, not null)
- `discount_type` (discount_type, not null)
- `discount_value` (bigint, not null)
- `gross_minor` (bigint, not null, = quantity * selling_price_snapshot_minor)
- `item_discount_minor` (bigint, not null)
- `receipt_discount_allocated_minor` (bigint, not null)
- `net_total_minor` (bigint, not null)
- `cost_total_minor` (bigint, not null, = quantity * purchase_price_snapshot_minor)
- `profit_minor` (bigint, not null, = net_total_minor - cost_total_minor)
- `created_at` (timestamptz, default `now()`)
- Ограничение: `UNIQUE (sale_id, product_id)` — запрет дублирования одного товара в чеке.

### 3.4. `public.income_receipts` и `public.income_items` (Приходные накладные)
- Хранят реквизиты поставщика, номер накладной, дату прихода, итоговую сумму.
- Позиции прихода фиксируют `quantity`, `purchase_price_minor` и `subtotal_minor`.
- Ограничение: `UNIQUE (income_receipt_id, product_id)`.

### 3.5. `public.outcome_documents` и `public.outcome_items` (Акты списания)
- Хранят причину списания (`reason`), дату, комментарий (обязателен при `reason = 'other'`), итоговую себестоимость списания.
- Позиции фиксируют списанное количество и себестоимость товара на момент списания.
- Ограничение: `UNIQUE (outcome_document_id, product_id)`.

### 3.6. `public.stock_movements` (История складских движений)
- `id` (uuid, PK)
- `product_id` (uuid, references `products(id)`)
- `movement_type` (movement_type, not null)
- `quantity_delta` (integer, not null, != 0: положительный для прихода/ввода остатка, отрицательный для продажи/списания)
- `balance_after` (integer, not null, >= 0)
- `occurred_at` (timestamptz, not null)
- `reference_id` (uuid, ID документа: sale, income_receipt или outcome_document)
- `reference_number` (text, номер документа)
- `product_name_snapshot` (text, not null)
- `sku_snapshot` (text, not null)
- `responsible_id` (uuid, references `profiles(id)`)
- `responsible_name` (text, not null)
- `note` (text)
- `created_at` (timestamptz, default `now()`)

---

## 4. Безопасность и RLS

1. **Изолированная схема `private`:**
   - Содержит `SECURITY DEFINER` функции: `private.is_active_user()`, `private.is_admin()`, `private.current_user_role()`.
   - Функции имеют жестко зафиксированный `SET search_path = ''` и полностью квалифицированные имена таблиц.
   - Предотвращают рекурсию в RLS-политиках `profiles`.
2. **Анонимный доступ (`anon`):**
   - Полностью закрыт: `REVOKE ALL ON ALL TABLES/FUNCTIONS/SEQUENCES IN SCHEMA public FROM anon, public`.
3. **Авторизованные сотрудники (`authenticated`):**
   - Явно отозваны все стандартные права записи: `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated`.
   - Выдано право только на чтение (`SELECT`) при условии `is_active = true`.
   - В `profiles` кассир видит только свой профиль (`id = (select auth.uid())`), администратор видит все профили.
4. **Регистрация пользователей:**
   - Открытая регистрация отключена в `config.toml` (`enable_signup = false`).
   - Новые профили создаются в неактивном состоянии (`is_active = false`), что исключает несанкционированный доступ к данным магазина.

---

## 5. Инструкция: Активация сотрудника и назначение администратора

При создании пользователя через приглашение или регистрацию trigger `handle_new_user` создаёт профиль с `role = 'cashier'` и `is_active = false`.

### 5.1. Активация и назначение первого администратора
Выполните в **SQL Editor** в консоли Supabase:

```sql
-- Активация и повышение пользователя до роли admin по email
UPDATE public.profiles
SET is_active = true,
    role = 'admin'::public.app_role,
    updated_at = now()
WHERE id = (
  SELECT id FROM auth.users WHERE email = 'admin@your-store.com'
);
```

### 5.2. Активация кассира
```sql
-- Активация обычного кассира
UPDATE public.profiles
SET is_active = true,
    updated_at = now()
WHERE id = (
  SELECT id FROM auth.users WHERE email = 'cashier@your-store.com'
);
```

---

## 6. RPC-функции, запланированные на следующем этапе

Для обеспечения транзакционности, пересчёта остатков и защиты от race conditions на следующем этапе будут разработаны следующие RPC:
1. `rpc_create_sale(sale_data, items_data)`:
   - Проверяет остатки товаров.
   - Списывает остатки в `public.products`.
   - Создаёт запись `public.sales` и строки `public.sale_items`.
   - Генерирует записи в `public.stock_movements` для каждой позиции.
2. `rpc_create_income_receipt(income_data, items_data)`:
   - Увеличивает остатки товаров в `public.products`.
   - Обновляет закупочную цену товара.
   - Создаёт накладную `public.income_receipts` и позиции `public.income_items`.
   - Создаёт движения в `public.stock_movements`.
3. `rpc_create_outcome_document(outcome_data, items_data)`:
   - Проверяет и списывает остатки.
   - Создаёт документ списания `public.outcome_documents` и позиции `public.outcome_items`.
   - Создаёт движения в `public.stock_movements`.
4. `rpc_create_product(product_data)`:
   - Создаёт новый товар.
   - При начальном остатке > 0 создаёт движение `opening_balance`.
5. `rpc_update_product(product_id, product_data)`:
   - Обновляет параметры товара.
6. `rpc_archive_product(product_id)`:
   - Мягко архивирует товар (`is_archived = true`).
