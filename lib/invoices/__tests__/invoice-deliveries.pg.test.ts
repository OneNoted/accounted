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
}): Promise<string> {
  const deliveryId = randomUUID()
  await getPool().query(
    `INSERT INTO public.invoice_deliveries
       (id, user_id, company_id, invoice_id, channel, status,
        to_addresses, cc_addresses, reply_to, from_name, subject,
        body_text, body_html, document_attachment_id, attachment_filename,
        attachment_content_type, attachment_sha256)
     VALUES ($1, $2, $3, $4, 'email', 'pending',
             ARRAY['customer@example.com'], ARRAY['copy@example.com'],
             'sender@example.com', 'Example AB', 'Faktura F-1001',
             'Exact plain text', '<p>Exact HTML</p>', $5,
             'invoice.pdf', 'application/pdf', $6)`,
    [
      deliveryId,
      params.userId,
      params.companyId,
      params.invoiceId,
      params.documentId,
      'a'.repeat(64),
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
    await expect(
      getPool().query(`DELETE FROM public.invoice_deliveries WHERE id = $1`, [deliveryId]),
    ).rejects.toThrow(/invoice delivery history is immutable/i)
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
})
