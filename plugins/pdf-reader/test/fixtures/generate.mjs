// Tiny synthetic fixtures: no external font, document or user content is needed.
import { writeFile } from 'node:fs/promises'
function pdf(count, text = true) {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '']
  const pages = []
  for (let index = 0; index < count; index++) {
    const pageId = objects.length + 1,
      streamId = pageId + 1
    pages.push(`${pageId} 0 R`)
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents ${streamId} 0 R >>`,
    )
    const stream = text
      ? `BT /F1 18 Tf 60 740 Td (Synthetic PDF page ${index + 1}) Tj ET`
      : '0.8 g 60 60 480 680 re f'
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`)
  }
  objects[1] = `<< /Type /Pages /Count ${count} /Kids [${pages.join(' ')}] >>`
  let output = '%PDF-1.7\n',
    offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(output))
    output += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = Buffer.byteLength(output)
  output +=
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets
      .slice(1)
      .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
      .join('')
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return output
}
await writeFile(new URL('./image-only.pdf', import.meta.url), pdf(1, false))
await writeFile(new URL('./chapters.pdf', import.meta.url), pdf(52))
await writeFile(
  new URL('./damaged.pdf', import.meta.url),
  '%PDF-1.7\nthis file intentionally has no object table\n%%EOF',
)
