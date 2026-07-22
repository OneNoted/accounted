import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { getPool, withUserContext } from '@/tests/pg/setup'
import { insertAuthUser, insertCompanyMember, seedCompany } from '@/tests/pg/fixtures'

async function insertInvoice(userId: string, companyId: string): Promise<string> {
  const customerId = randomUUID()
  const invoiceId = randomUUID()
  await getPool().query(
    `INSERT INTO public.customers (id, user_id, company_id, name)
     VALUES ($1, $2, $3, 'Delivery History Customer')`,
    [customerId, userId, companyId],
  )
  await getPool().query(
    `INSERT INTO public.invoices
       (id, user_id, company_id, customer_id, invoice_number,
        invoice_date, due_date, currency, subtotal, vat_amount, total,
        vat_treatment, vat_rate, moms_ruta, status)
     VALUES ($1, $2, $3, $4, $5,
             '2026-07-22', '2026-08-21', 'SEK', 1000, 250, 1250,
             'standard_25', 25, '10', 'sent')`,
    [invoiceId, userId, companyId, customerId, `F-${randomUUID().slice(0, 8)}`],
  )
  return invoiceId
}

async function insertDocument(userId: string, companyId: string): Promise<string> {
  const documentId = randomUUID()
  await getPool().query(
    `INSERT INTO public.document_attachments
       (id, user_id, company_id, storage_path, file_name, file_size_bytes,
        mime_type, sha256_hash)
     VALUES ($1, $2, $3, $4, 'invoice.pdf', 1024, 'application/pdf', $5)`,
    [
      documentId,
      userId,
      companyId,
      `documents/${userId}/${documentId}.pdf`,
      'a'.repeat(64),
    ],
  )
  return documentId
}

async function insertManualDelivery(params: {
  userId: string
  companyId: string
  invoiceId: string
}): Promise<string> {
  const deliveryId = randomUUID()
  await getPool().query(
    `INSERT INTO public.invoice_deliveries
       (id, user_id, company_id, invoice_id, channel, status, sent_at)
     VALUES ($1, $2, $3, $4, 'manual', 'marked_sent', now())`,
    [deliveryId, params.userId, params.companyId, params.invoiceId],
  )
  return deliveryId
}

async function insertPendingEmailDelivery(params: {
  userId: string
  companyId: string
  invoiceId: string
  documentId: string
  retentionExpiresAt?: string
}): Promise<string> {
  const deliveryId = randomUUID()
  await getPool().query(
    `INSERT INTO public.invoice_deliveries
       (id, user_id, company_id, invoice_id, channel, status,
        to_addresses, cc_addresses, reply_to, from_name, subject,
        body_text, body_html, document_attachment_id, attachment_filename,
        attachment_content_type, attachment_sha256, retention_expires_at)
     VALUES ($1, $2, $3, $4, 'email', 'pending',
             ARRAY['customer@example.com'], ARRAY['copy@example.com'],
             'sender@example.com', 'Example AB', 'Faktura F-1001',
             'Exact plain text', '<p>Exact HTML</p>', $5,
             'invoice.pdf', 'application/pdf', $6, $7)`,
    [
      deliveryId,
      params.userId,
      params.companyId,
      params.invoiceId,
      params.documentId,
      'a'.repeat(64),
      params.retentionExpiresAt ?? null,
    ],
  )
  return deliveryId
}

describe('invoice_deliveries.pg: immutable delivery evidence', () => {
  it('allows only a pending to terminal transition and then locks the row', async () => {
    const { userId, companyId } = await seedCompany()
    const invoiceId = await insertInvoice(userId, companyId)
    const documentId = await insertDocument(userId, companyId)
    const deliveryId = await insertPendingEmailDelivery({
      userId,
      companyId,
      invoiceId,
      documentId,
    })

    await getPool().query(
      `UPDATE public.invoice_deliveries
          SET status = 'sent', provider = 'resend',
              provider_message_id = 'provider-1', sent_at = now()
        WHERE id = $1`,
      [deliveryId],
    )

    await expect(
      getPool().query(
        `UPDATE public.invoice_deliveries SET body_text = 'tampered' WHERE id = $1`,
        [deliveryId],
      ),
    ).rejects.toThrow(/terminal invoice delivery.*immutable/i)
    await getPool().query(`DELETE FROM public.invoice_deliveries WHERE id = $1`, [deliveryId])
    const retained = await getPool().query(
      `SELECT id FROM public.invoice_deliveries WHERE id = $1`,
      [deliveryId],
    )
    const deleteAudit = await getPool().query(
      `SELECT old_state
         FROM public.audit_log
        WHERE table_name = 'invoice_deliveries'
          AND record_id = $1
          AND action = 'SECURITY_EVENT'
        ORDER BY created_at DESC
        LIMIT 1`,
      [deliveryId],
    )
    expect(retained.rowCount).toBe(1)
    expect(deleteAudit.rowCount).toBe(1)
    expect(deleteAudit.rows[0].old_state).not.toHaveProperty('body_text')
    expect(deleteAudit.rows[0].old_state).not.toHaveProperty('to_addresses')
  })

  it('blocks payload changes while finalizing a pending email', async () => {
    const { userId, companyId } = await seedCompany()
    const invoiceId = await insertInvoice(userId, companyId)
    const documentId = await insertDocument(userId, companyId)
    const deliveryId = await insertPendingEmailDelivery({
      userId,
      companyId,
      invoiceId,
      documentId,
    })

    await expect(
      getPool().query(
        `UPDATE public.invoice_deliveries
            SET status = 'sent', sent_at = now(), subject = 'Changed subject'
          WHERE id = $1`,
        [deliveryId],
      ),
    ).rejects.toThrow(/invoice delivery payload is immutable/i)
  })

  it('rejects invoice and document references from another company', async () => {
    const a = await seedCompany()
    const b = await seedCompany()
    const invoiceA = await insertInvoice(a.userId, a.companyId)
    const documentB = await insertDocument(b.userId, b.companyId)

    await expect(
      insertManualDelivery({
        userId: b.userId,
        companyId: b.companyId,
        invoiceId: invoiceA,
      }),
    ).rejects.toThrow(/invoice delivery invoice\/company mismatch/i)

    await expect(
      insertPendingEmailDelivery({
        userId: a.userId,
        companyId: a.companyId,
        invoiceId: invoiceA,
        documentId: documentB,
      }),
    ).rejects.toThrow(/invoice delivery document\/company mismatch/i)
  })

  it('prevents deletion of the exact PDF after a successful send', async () => {
    const { userId, companyId } = await seedCompany()
    const invoiceId = await insertInvoice(userId, companyId)
    const documentId = await insertDocument(userId, companyId)
    const deliveryId = await insertPendingEmailDelivery({
      userId,
      companyId,
      invoiceId,
      documentId,
    })
    await getPool().query(
      `UPDATE public.invoice_deliveries SET status = 'sent', sent_at = now() WHERE id = $1`,
      [deliveryId],
    )

    await expect(
      getPool().query(`DELETE FROM public.document_attachments WHERE id = $1`, [documentId]),
    ).rejects.toThrow(/exact PDF sent with a customer invoice/i)
  })

  it('isolates delivery history by company through RLS', async () => {
    const a = await seedCompany()
    const b = await seedCompany()
    const deliveryA = await insertManualDelivery({
      userId: a.userId,
      companyId: a.companyId,
      invoiceId: await insertInvoice(a.userId, a.companyId),
    })
    await insertManualDelivery({
      userId: b.userId,
      companyId: b.companyId,
      invoiceId: await insertInvoice(b.userId, b.companyId),
    })

    const visibleIds = await withUserContext(a.userId, async (client) => {
      const result = await client.query<{ id: string }>(
        `SELECT id FROM public.invoice_deliveries WHERE company_id = ANY($1::uuid[])`,
        [[a.companyId, b.companyId]],
      )
      return result.rows.map((row) => row.id)
    })

    expect(visibleIds).toEqual([deliveryA])
  })

  it('denies inserts to a viewer', async () => {
    const { userId, companyId } = await seedCompany()
    const viewerId = await insertAuthUser()
    await insertCompanyMember({ companyId, userId: viewerId, role: 'viewer' })
    const invoiceId = await insertInvoice(userId, companyId)

    await expect(
      withUserContext(viewerId, async (client) => {
        await client.query(
          `INSERT INTO public.invoice_deliveries
             (user_id, company_id, invoice_id, channel, status, sent_at)
           VALUES ($1, $2, $3, 'manual', 'marked_sent', now())`,
          [viewerId, companyId, invoiceId],
        )
      }),
    ).rejects.toThrow(/row-level security|policy/i)
  })

  it('reserves one preparing attempt and promotes it to the exact pending payload', async () => {
    const { userId, companyId } = await seedCompany()
    const invoiceId = await insertInvoice(userId, companyId)
    const documentId = await insertDocument(userId, companyId)
    const deliveryId = randomUUID()

    await getPool().query(
      `INSERT INTO public.invoice_deliveries
         (id, user_id, company_id, invoice_id, channel, status)
       VALUES ($1, $2, $3, $4, 'email', 'preparing')`,
      [deliveryId, userId, companyId, invoiceId],
    )

    await expect(
      getPool().query(
        `INSERT INTO public.invoice_deliveries
           (user_id, company_id, invoice_id, channel, status)
         VALUES ($1, $2, $3, 'email', 'preparing')`,
        [userId, companyId, invoiceId],
      ),
    ).rejects.toThrow(/duplicate key|unique constraint/i)

    await getPool().query(
      `UPDATE public.invoice_deliveries
          SET status = 'pending',
              to_addresses = ARRAY['customer@example.com'],
              subject = 'Faktura F-1001',
              body_text = 'Exact plain text',
              body_html = '<p>Exact HTML</p>',
              document_attachment_id = $2,
              attachment_filename = 'invoice.pdf',
              attachment_content_type = 'application/pdf',
              attachment_sha256 = $3
        WHERE id = $1`,
      [deliveryId, documentId, 'a'.repeat(64)],
    )

    const result = await getPool().query(
      `SELECT status, retention_expires_at
         FROM public.invoice_deliveries
        WHERE id = $1`,
      [deliveryId],
    )
    expect(result.rows[0].status).toBe('pending')
    expect(result.rows[0].retention_expires_at).toBeTruthy()
  })

  it('allows a failed attempt to release and delete its unsent PDF', async () => {
    const { userId, companyId } = await seedCompany()
    const invoiceId = await insertInvoice(userId, companyId)
    const documentId = await insertDocument(userId, companyId)
    const deliveryId = await insertPendingEmailDelivery({
      userId,
      companyId,
      invoiceId,
      documentId,
    })

    await getPool().query(
      `UPDATE public.invoice_deliveries
          SET status = 'failed', failed_at = now(),
              error_code = 'provider_failed', document_attachment_id = NULL
        WHERE id = $1`,
      [deliveryId],
    )
    await getPool().query(
      `DELETE FROM public.document_attachments WHERE id = $1`,
      [documentId],
    )

    const document = await getPool().query(
      `SELECT id FROM public.document_attachments WHERE id = $1`,
      [documentId],
    )
    expect(document.rowCount).toBe(0)
  })

  it('redacts expired delivery PII and keeps metadata-only audit state', async () => {
    const { userId, companyId } = await seedCompany()
    const invoiceId = await insertInvoice(userId, companyId)
    const documentId = await insertDocument(userId, companyId)
    const deliveryId = await insertPendingEmailDelivery({
      userId,
      companyId,
      invoiceId,
      documentId,
      retentionExpiresAt: '2000-01-01',
    })
    await getPool().query(
      `UPDATE public.invoice_deliveries SET status = 'sent', sent_at = now() WHERE id = $1`,
      [deliveryId],
    )

    await getPool().query(`SELECT public.redact_expired_invoice_delivery_pii()`)

    const delivery = await getPool().query(
      `SELECT to_addresses, body_text, subject, provider_message_id,
              attachment_filename, attachment_sha256, pii_redacted_at
         FROM public.invoice_deliveries
        WHERE id = $1`,
      [deliveryId],
    )
    expect(delivery.rows[0]).toMatchObject({
      to_addresses: [],
      body_text: null,
      subject: null,
      provider_message_id: null,
      attachment_filename: null,
      attachment_sha256: null,
    })
    expect(delivery.rows[0].pii_redacted_at).toBeTruthy()

    const audit = await getPool().query(
      `SELECT new_state
         FROM public.audit_log
        WHERE table_name = 'invoice_deliveries'
          AND record_id = $1
        ORDER BY created_at DESC
        LIMIT 1`,
      [deliveryId],
    )
    expect(audit.rows[0].new_state).not.toHaveProperty('body_text')
    expect(audit.rows[0].new_state).not.toHaveProperty('to_addresses')
  })

  it('uses restrictive parent foreign keys for immutable delivery evidence', async () => {
    const constraints = await getPool().query<{ conname: string; confdeltype: string }>(
      `SELECT conname, confdeltype
         FROM pg_constraint
        WHERE conrelid = 'public.invoice_deliveries'::regclass
          AND conname IN (
            'invoice_deliveries_company_id_fkey',
            'invoice_deliveries_user_id_fkey'
          )
        ORDER BY conname`,
    )

    expect(constraints.rows).toEqual([
      { conname: 'invoice_deliveries_company_id_fkey', confdeltype: 'r' },
      { conname: 'invoice_deliveries_user_id_fkey', confdeltype: 'r' },
    ])
  })
})
