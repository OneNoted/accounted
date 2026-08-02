// AUTO-GENERATED: do not edit. Run `npm run setup:extensions` to regenerate.
import type { ComponentType } from 'react'
import type { WorkspaceComponentProps } from '../workspace-registry'
import EnableBankingWorkspace from '@/components/extensions/general/EnableBankingWorkspace'
import ArcimMigrationWorkspace from '@/components/extensions/general/ArcimMigrationWorkspace'
import TicWorkspace from '@/components/extensions/general/TicWorkspace'
import CloudBackupWorkspace from '@/components/extensions/general/CloudBackupWorkspace'
import InvoiceInboxWorkspace from '@/components/extensions/general/InvoiceInboxWorkspace'

export const WORKSPACES: Record<string, ComponentType<WorkspaceComponentProps>> = {
  'general/enable-banking': EnableBankingWorkspace,
  'general/arcim-migration': ArcimMigrationWorkspace,
  'general/tic': TicWorkspace,
  'general/cloud-backup': CloudBackupWorkspace,
  'general/invoice-inbox': InvoiceInboxWorkspace,
}
