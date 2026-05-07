import * as XLSX from 'xlsx'
import { decodeFileContent } from './encoding'

/**
 * Read a workbook from a raw file buffer, with correct encoding handling
 * for CSV files.
 *
 * For binary spreadsheet formats (.xlsx, .xls, .ods), xlsx handles encoding
 * via the embedded codepage and we pass the buffer through as `type: 'array'`.
 *
 * For CSV files, xlsx with `type: 'array'` decodes bytes as Latin-1, which
 * mangles UTF-8 multi-byte sequences (e.g. Ö → Ã–). We instead detect the
 * source encoding (UTF-8 with optional BOM, or Windows-1252) and decode to
 * a string before handing it to xlsx as `type: 'string'`.
 */
export function readWorkbookFromBuffer(buffer: ArrayBuffer, filename: string): XLSX.WorkBook {
  const ext = filename.toLowerCase().split('.').pop() ?? ''
  if (ext === 'csv') {
    const content = decodeFileContent(buffer)
    return XLSX.read(content, { type: 'string' })
  }
  return XLSX.read(buffer, { type: 'array' })
}
