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
   - Складские движения (`stock_movements`) являются неизменяемыми записями аудита (тип, дельта количества, временная метка, автор и документ-основание неизменны). Поле `balance_after` хранит вычисленный накопительный остаток на соответствующий момент времени; при проведении документов задним числом `balance_after` последующих движений автоматически пересчитывается для сохранения хронологической целостности складского баланса.
   - Таблица `product_price_history` автоматически фиксирует историю изменения цен (при создании, редактировании и приходе товара), гарантируя точное определение себестоимости даже для документов, оформляемых задним числом.
5. **Защита от прямых мутаций (RPC-only Mutex):**
   - На уровне прав и RLS пользователям роли `authenticated` предоставлен только доступ `SELECT`.
   - Прямые `INSERT`, `UPDATE`, `DELETE` для бизнес-таблиц закрыты как на уровне `GRANT/REVOKE`, так и на уровне RLS-политик.
   - Все мутации выполняются исключительно через транзакционные RPC-функции (`SECURITY DEFINER`), гарантирующие атомарное обновление складских остатков и создание движений.

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

### 3.3. `public.product_price_history` (История цен товаров)
- `id` (uuid, PK)
- `product_id` (uuid, references `products(id)` on delete cascade)
- `purchase_price_minor` (bigint, not null)
- `selling_price_minor` (bigint, not null)
- `effective_from` (timestamptz, not null)
- `source` (text, not null: `'initial'` — начальная цена при создании/миграции, `'income_receipt'` / `'income'` — проведение приходной накладной, `'update'` — ручное редактирование цены в каталоге, `'sale_snapshot'` — восстановленная цена из чека продажи, `'outcome_snapshot'` — восстановленная себестоимость из акта списания, `'catalog_sync'` — синхронизация изменённой цены каталога)
- `created_at` (timestamptz, default `clock_timestamp()`)

### 3.4. `public.sales` и `public.sale_items` (Продажи и позиции чеков)
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

### 3.5. `public.income_receipts` и `public.income_items` (Приходные накладные)
- Хранят реквизиты поставщика, номер накладной, дату прихода, итоговую сумму.
- Позиции прихода фиксируют `quantity`, `purchase_price_minor` и `subtotal_minor`.
- Ограничение: `UNIQUE (income_receipt_id, product_id)`.

### 3.6. `public.outcome_documents` и `public.outcome_items` (Акты списания)
- Хранят причину списания (`reason`), дату, комментарий (обязателен при `reason = 'other'`), итоговую себестоимость списания.
- Позиции фиксируют списанное количество и себестоимость товара на момент списания.
- Ограничение: `UNIQUE (outcome_document_id, product_id)`.

### 3.7. `public.stock_movements` (История складских движений)
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

1. **Функции схемы `private`:**
   - **RLS Helper Functions:** `private.is_active_user()`, `private.is_admin()`, `private.current_user_role()` имеют `SET search_path = ''` и полностью квалифицированные имена; право `EXECUTE` предоставлено `authenticated` для вычисления политик RLS.
   - **RPC Security Helper:** `private.get_active_profile()` имеет `SET search_path = pg_catalog, public, private, pg_temp`, используется внутри RPC-функций; прямой доступ к ней полностью отозван (`REVOKE ALL FROM PUBLIC, anon, authenticated`).
2. **Анонимный доступ (`anon`):**
   - Полностью закрыт: `REVOKE ALL ON ALL TABLES/FUNCTIONS/SEQUENCES IN SCHEMA public FROM anon, public`.
3. **Авторизованные сотрудники (`authenticated`):**
   - Явно отозваны все стандартные права записи: `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated`.
   - Выдано право только на чтение (`SELECT`) при условии `is_active = true`.
   - В `profiles` кассир видит только свой профиль (`id = (select auth.uid())`), администратор видит все профили.
   - Прямые вызовы разрешены только для точно специфицированных публичных RPC-функций.
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

## 6. Атомарные бизнес-функции (RPC API)

Все операции создания документов, изменения остатков и управления товарами выполняются исключительно через защищённые транзакционные PostgreSQL RPC-функции (`SECURITY DEFINER`, `SET search_path = pg_catalog, public, private, pg_temp`). Прямые мутации таблиц фронтендом запрещены.

### 6.1. Матрица доступа к RPC

| RPC-функция | Назначение | Разрешённые роли | Блокировки (Deadlock-safe) |
|---|---|---|---|
| `public.rpc_create_product` | Создание нового товара + ввод начального остатка | `admin` (`is_active = true`) | — |
| `public.rpc_update_product` | Редактирование реквизитов и цен товара | `admin` (`is_active = true`) | `SELECT FOR UPDATE` |
| `public.rpc_adjust_product_stock` | Инвентаризационная корректировка остатка | `admin` (`is_active = true`) | `SELECT FOR UPDATE` |
| `public.rpc_archive_product` | Архивирование товара (только при остатке = 0) | `admin` (`is_active = true`) | `SELECT FOR UPDATE` |
| `public.rpc_create_income_receipt` | Проведение приходной накладной | `admin` (`is_active = true`) | `ORDER BY id ASC FOR UPDATE` |
| `public.rpc_create_sale` | Проведение продажи / фискального чека | `admin`, `cashier` (`is_active = true`) | `ORDER BY id ASC FOR UPDATE` |
| `public.rpc_create_outcome_document` | Проведение акта списания | `admin` (`is_active = true`) | `ORDER BY id ASC FOR UPDATE` |

Анонимный доступ (`anon`, `public`) к RPC-функциям полностью отозван по точным сигнатурам. Прямой доступ к последовательностям (`sequences`) и внутренним функциям `private.*` закрыт.

---

### 6.2. Детальная спецификация RPC-функций

#### 1. `public.rpc_create_product`
- **Доступ:** `admin` (`is_active = true`).
- **Параметры:**
  - `p_sku` (text) — артикул (уникален без учёта регистра);
  - `p_barcode` (text) — штрихкод (уникален);
  - `p_name` (text) — наименование товара;
  - `p_category` (text) — идентификатор категории;
  - `p_category_label` (text) — название категории;
  - `p_purchase_price_minor` (bigint) — закупочная цена в тыйынах (>= 0);
  - `p_selling_price_minor` (bigint) — розничная цена в тыйынах (>= purchase_price);
  - `p_description` (text, default NULL) — описание;
  - `p_stock` (integer, default 0) — начальный остаток (>= 0);
  - `p_min_stock_threshold` (integer, default 0) — минимальный порог остатка.
- **Действия:** Вставляет запись в `public.products` и создаёт начальную запись в `public.product_price_history`. Если `p_stock > 0`, атомарно создаёт запись `opening_balance` в `public.stock_movements`.
- **Возвращает:** строку `public.products`.

#### 2. `public.rpc_update_product`
- **Доступ:** `admin` (`is_active = true`).
- **Параметры:** `p_product_id` (uuid), `p_sku`, `p_barcode`, `p_name`, `p_category`, `p_category_label`, `p_purchase_price_minor`, `p_selling_price_minor`, `p_description`, `p_min_stock_threshold`.
- **Действия:** Блокирует строку товара (`FOR UPDATE`), проверяет уникальность SKU/barcode среди других товаров и обновляет реквизиты. При изменении цен фиксирует новую запись в `public.product_price_history`. Остаток `stock` этим методом не меняется.
- **Возвращает:** обновлённую строку `public.products`.

#### 3. `public.rpc_adjust_product_stock`
- **Доступ:** `admin` (`is_active = true`).
- **Параметры:** `p_product_id` (uuid), `p_new_stock` (integer, >= 0), `p_reason` (text, non-empty).
- **Действия:** Блокирует строку товара (`FOR UPDATE`), вычисляет дельту остатка `delta = new_stock - current_stock`. Если дельта != 0, обновляет `products.stock` и создаёт движение с типом `inventory_adjustment` с автоматическим сдвигом накопительных остатков последующих движений.
- **Возвращает:** обновлённую строку `public.products`.

#### 4. `public.rpc_archive_product`
- **Доступ:** `admin` (`is_active = true`).
- **Параметры:** `p_product_id` (uuid), `p_is_archived` (boolean, default true).
- **Действия:** Блокирует строку товара (`FOR UPDATE`). При `p_is_archived = true` проверяет правило учёта: архивирование разрешено **только при `stock = 0`**. Устанавливает флаг `is_archived`.
- **Возвращает:** обновлённую строку `public.products`.

#### 5. `public.rpc_create_income_receipt`
- **Доступ:** `admin` (`is_active = true`).
- **Параметры:**
  - `p_supplier` (text, non-empty) — наименование поставщика;
  - `p_supplier_document_number` (text, default NULL) — номер накладной поставщика;
  - `p_received_at` (timestamptz, default now()) — дата и время поступления;
  - `p_comment` (text, default NULL) — примечание;
  - `p_items` (jsonb array): `[{"product_id": uuid, "quantity": int (>0), "purchase_price_minor": bigint (>=0)}]`;
  - `p_id` (uuid, default NULL) — опциональный ID документа для идемпотентности повторных вызовов.
- **Действия:**
  1. При повторном вызове с существующим `p_id` возвращает ранее созданный документ без повторного изменения склада.
  2. Блокирует строки товаров по `id = ANY(...) ORDER BY id ASC FOR UPDATE`.
  3. Проверяет соотношение цен: входящая закупочная цена не может превышать текущую цену продажи товара в каталоге.
  4. Генерирует уникальный номер документа из последовательности `public.income_receipt_seq` (формат `ПР-YYYY-001`, без обрезания).
  5. Создаёт запись в `public.income_receipts`.
  6. Создаёт строки в `public.income_items` и добавляет записи в `public.product_price_history`.
  7. Увеличивает остаток `products.stock += quantity` и обновляет `products.purchase_price_minor` (только если накладная является хронологически последней).
  8. Формирует движения `income` в `public.stock_movements` и сдвигает `balance_after` последующих движений.
- **Возвращает:** `jsonb` объект `{ id, receipt_number, total_cost_minor, total_minor, items_count }`.

#### 6. `public.rpc_create_sale`
- **Доступ:** `admin`, `cashier` (`is_active = true`).
- **Параметры:**
  - `p_payment_method` (payment_method: 'cash', 'card', 'transfer');
  - `p_receipt_discount_type` (discount_type: 'none', 'fixed', 'percent', default 'none');
  - `p_receipt_discount_value` (bigint, в тыйынах для fixed, в basis points 0..10000 для percent, default 0);
  - `p_received_minor` (bigint, обязательно для cash, должно быть >= total_minor, default NULL);
  - `p_sold_at` (timestamptz, default now());
  - `p_comment` (text, default NULL);
  - `p_items` (jsonb array): `[{"product_id": uuid, "quantity": int (>0), "unit_price_minor": bigint (опционально), "discount_type": text, "discount_value": bigint}]`;
  - `p_id` (uuid, default NULL) — опциональный ID документа для идемпотентности.
- **Действия:**
  1. При повторном вызове с существующим `p_id` возвращает результат ранее оформленного чека.
  2. Блокирует все покупаемые товары по `id = ANY(...) ORDER BY id ASC FOR UPDATE` для защиты от гонок и взаимных блокировок.
  3. Проверяет доступность остатка как на текущий момент, так и по всей последующей хронологической истории движений.
  4. Точно определяет историческую себестоимость товаров на дату продажи по `public.product_price_history` (`effective_from <= p_sold_at`).
  5. Проводит независимый серверный пересчёт стоимости с защитой от переполнения промежуточных вычислений через `numeric`:
     - скидка на позицию (`item_discount_minor`);
     - общая скидка чека (`receipt_discount_minor`);
     - пропорциональное распределение скидки чека по позициям с защитой от превышения цены строки и безопасным распределением копеечного остатка по позициям с доступной суммой;
     - расчет чистой выручки (`net_total_minor`) и себестоимости (`cost_total_minor`);
     - расчет валовой прибыли (`profit_minor = net_total_minor - cost_total_minor`);
     - проверка наличных: вычисление сдачи (`change_minor = received_minor - total_minor`), для безналичных платежей `received_minor = NULL, change_minor = NULL`.
  6. Генерирует уникальный номер чека из `public.sale_receipt_seq` (формат `ЧЕК-YYYY-001000`, без обрезания).
  7. Вставляет запись в `public.sales` и строки в `public.sale_items`.
  8. Списывает остатки в `public.products.stock`.
  9. Создаёт движения `sale` с отрицательной дельтой `-quantity` в `public.stock_movements` и сдвигает `balance_after` будущих движений.
- **Возвращает:** `jsonb` объект `{ id, receipt_number, total_minor, profit_minor, change_minor, items_count }`.

#### 7. `public.rpc_create_outcome_document`
- **Доступ:** `admin` (`is_active = true`).
- **Параметры:**
  - `p_reason` (outcome_reason: 'damaged', 'defective', 'lost', 'internal_use', 'other');
  - `p_reason_comment` (text, обязательно при `reason = 'other'`, default NULL);
  - `p_occurred_at` (timestamptz, default now());
  - `p_items` (jsonb array): `[{"product_id": uuid, "quantity": int (>0)}]`;
  - `p_id` (uuid, default NULL) — опциональный ID документа для идемпотентности.
- **Действия:**
  1. При повторном вызове с существующим `p_id` возвращает ранее созданный акт списания.
  2. Блокирует списываемые товары `ORDER BY id ASC FOR UPDATE`.
  3. Проверяет наличие достаточного остатка в текущем каталоге и в хронологической истории.
  4. Точно определяет историческую себестоимость товаров на дату списания по `public.product_price_history`.
  5. Генерирует номер документа из `public.outcome_document_seq` (формат `СП-YYYY-001`, без обрезания).
  6. Создаёт запись в `public.outcome_documents` и позиции в `public.outcome_items` с фиксацией исторической себестоимости.
  7. Уменьшает остатки товаров в `public.products`.
  8. Создаёт движения `write_off` в `public.stock_movements` и сдвигает `balance_after` будущих движений.
- **Возвращает:** `jsonb` объект `{ id, document_number, total_cost_minor, items_count }`.
