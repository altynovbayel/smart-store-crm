/**
 * Expected client-side validation failure raised before the RPC is called.
 * Its message is user-facing Russian text and is shown verbatim;
 * any other thrown error is treated as internal and never exposed.
 */
export class OutcomeValidationError extends Error {
  readonly field?: string;

  constructor(message: string, field?: string) {
    super(message);
    this.name = 'OutcomeValidationError';
    this.field = field;
  }
}
