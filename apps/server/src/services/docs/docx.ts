import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import type { Block, DocumentModel } from './templates.js';

function blockToDocx(block: Block): (Paragraph | Table)[] {
  switch (block.kind) {
    case 'heading':
      return [
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: [new TextRun({ text: block.text, bold: true, size: 24, color: '374151' })],
          spacing: { before: 240, after: 80 },
        }),
      ];
    case 'paragraph':
      return [
        new Paragraph({
          children: [new TextRun({ text: block.text, size: 22 })],
          spacing: { after: 120 },
        }),
      ];
    case 'bullets':
      return block.items.map(
        (item) =>
          new Paragraph({
            children: [new TextRun({ text: item, size: 22 })],
            bullet: { level: 0 },
            spacing: { after: 60 },
          }),
      );
    case 'kv':
      return [
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: block.rows.map(
            ([k, v]) =>
              new TableRow({
                children: [
                  new TableCell({
                    width: { size: 38, type: WidthType.PERCENTAGE },
                    children: [new Paragraph({ children: [new TextRun({ text: k, bold: true, size: 21 })] })],
                  }),
                  new TableCell({
                    children: [new Paragraph({ children: [new TextRun({ text: v, size: 21 })] })],
                  }),
                ],
              }),
          ),
        }),
        new Paragraph({ text: '', spacing: { after: 120 } }),
      ];
    case 'table':
      return [
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              tableHeader: true,
              children: block.headers.map(
                (h) =>
                  new TableCell({
                    shading: { fill: 'F3F4F6' },
                    children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, size: 19 })] })],
                  }),
              ),
            }),
            ...block.rows.map(
              (row) =>
                new TableRow({
                  children: row.map(
                    (cell) =>
                      new TableCell({
                        borders: {
                          top: { style: BorderStyle.SINGLE, size: 1, color: 'D1D5DB' },
                          bottom: { style: BorderStyle.SINGLE, size: 1, color: 'D1D5DB' },
                          left: { style: BorderStyle.SINGLE, size: 1, color: 'D1D5DB' },
                          right: { style: BorderStyle.SINGLE, size: 1, color: 'D1D5DB' },
                        },
                        children: [new Paragraph({ children: [new TextRun({ text: cell, size: 19 })] })],
                      }),
                  ),
                }),
            ),
          ],
        }),
        new Paragraph({ text: '', spacing: { after: 120 } }),
      ];
    case 'notice':
      return [
        new Paragraph({
          children: [
            new TextRun({
              text: block.text,
              size: 19,
              italics: true,
              color: block.tone === 'warn' ? '7F1D1D' : block.tone === 'draft' ? '7C4A03' : '1E3A8A',
            }),
          ],
          shading: { fill: block.tone === 'warn' ? 'FEF2F2' : block.tone === 'draft' ? 'FFF4E5' : 'EEF4FF' },
          spacing: { after: 180 },
        }),
      ];
    default:
      return [];
  }
}

export async function modelToDocx(model: DocumentModel): Promise<Buffer> {
  const doc = new Document({
    creator: 'VisaHOBe Agency OS',
    title: model.title,
    description: model.subtitle,
    sections: [
      {
        properties: {
          page: { margin: { top: 900, right: 900, bottom: 900, left: 900 } },
        },
        children: [
          new Paragraph({
            children: [new TextRun({ text: 'VisaHOBe Agency OS', size: 18, color: '6B7280', characterSpacing: 40 })],
            spacing: { after: 60 },
          }),
          new Paragraph({
            children: [new TextRun({ text: model.title, bold: true, size: 40 })],
            spacing: { after: 40 },
          }),
          new Paragraph({
            children: [new TextRun({ text: `${model.subtitle}${model.reference ? ` · Case ${model.reference}` : ''}`, size: 22, color: '4B5563' })],
            spacing: { after: 200 },
          }),
          ...model.blocks.flatMap(blockToDocx),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({
                text: 'Confidential applicant data — handle under the agency retention policy.',
                size: 16,
                color: '6B7280',
              }),
            ],
          }),
        ],
      },
    ],
  });
  return Packer.toBuffer(doc);
}
