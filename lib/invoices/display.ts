export const INVOICE_NUMBER_DRAFT_LABEL = '(Utkast)'

export function invoiceNumberDisplay(value: string | null | undefined): string {
  return value ?? INVOICE_NUMBER_DRAFT_LABEL
}
