/**
 * Expected client-side validation failure raised before rpc_create_sale is called.
 * Its message is user-facing Russian text and is shown verbatim;
 * any other thrown error is treated as internal and never exposed.
 */
export class SaleValidationError extends Error {
  readonly field?: string;

  constructor(message: string, field?: string) {
    super(message);
    this.name = 'SaleValidationError';
    this.field = field;
  }
}
