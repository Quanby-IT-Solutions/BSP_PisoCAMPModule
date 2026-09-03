import { Injectable } from "@nestjs/common"
import {
	Document,
	HeadingLevel,
	Packer,
	Paragraph,
	Table,
	TableCell,
	TableRow,
	TextRun,
	WidthType,
} from "docx"
import ExcelJS from "exceljs"
import { eq } from "drizzle-orm"
import PDFDocument from "pdfkit"

import type { ReportExportFormat, ReportRun } from "@repo/contracts/pisocamp-report"
import { reportRuns } from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { databaseTransactionContext } from "@/common/database/database-transaction.context"
import { db } from "@/common/database/database.client"

import { ReportService } from "./report.service"
import { reportHeader, reportTables, type ReportTable } from "./report-tables"

const MEDIA_TYPES: Record<ReportExportFormat, string> = {
	xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	pdf: "application/pdf",
}

/** BSP's house colour, so the three formats read as one set of documents. */
const HEADING_COLOR = "1F3864"

export interface ReportExport {
	fileName: string
	mediaType: string
	bytes: Buffer
}

@Injectable()
export class ReportExportService {
	constructor(
		private readonly reports: ReportService,
		private readonly auditService: AuditService
	) {}

	/**
	 * Render one generated report, and record that it left the building.
	 *
	 * The figures come from the stored run rather than from a fresh query: an
	 * export has to be the report it claims to be, not a re-run that may since
	 * have moved.
	 */
	async export(input: {
		runId: string
		format: ReportExportFormat
		actorId: string
	}): Promise<ReportExport | null> {
		const [row] = await db.select().from(reportRuns).where(eq(reportRuns.id, input.runId))
		if (!row) return null

		const run = this.reports.toReportRun(row)
		const bytes = await this.render(run, input.format)

		// The audit is written before the bytes are handed over, in its own
		// transaction: an export nobody recorded is an export nobody can answer
		// for, and §10 asks for exactly that record.
		await databaseTransactionContext.transaction(async tx => {
			await this.auditService.record(
				{
					domain: "pisocamp",
					action: "report.export",
					actorId: input.actorId,
					targetType: "report_run",
					targetId: run.id,
					newValue: {
						format: input.format,
						definitionKey: run.definitionKey,
						from: run.from,
						to: run.to,
						suppressed: run.suppressed,
					},
				},
				tx
			)
		})

		return {
			fileName: `${run.definitionKey}-${run.from}-to-${run.to}.${input.format}`,
			mediaType: MEDIA_TYPES[input.format],
			bytes,
		}
	}

	private render(run: ReportRun, format: ReportExportFormat): Promise<Buffer> {
		const header = reportHeader(run)
		const tables = reportTables(run)
		const note = run.suppressed ? run.suppressionReason : null

		if (format === "xlsx") return this.toWorkbook(run, header, tables, note)
		if (format === "docx") return this.toWordDocument(run, header, tables, note)
		return this.toPdf(run, header, tables, note)
	}

	private async toWorkbook(
		run: ReportRun,
		header: [string, string][],
		tables: ReportTable[],
		note: string | null
	): Promise<Buffer> {
		const workbook = new ExcelJS.Workbook()
		workbook.creator = "BSP Piso CAMP"
		workbook.created = new Date(run.generatedAt)

		// The metadata is its own sheet rather than rows above the figures, so a
		// reader can sort or filter the data without dragging the header into it.
		const cover = workbook.addWorksheet("Report")
		cover.columns = [
			{ header: "Field", key: "field", width: 24 },
			{ header: "Value", key: "value", width: 72 },
		]
		cover.getRow(1).font = { bold: true, color: { argb: `FF${HEADING_COLOR}` } }
		for (const [field, value] of header) cover.addRow({ field, value })
		if (note) cover.addRow({ field: "Figures withheld", value: note })

		for (const table of tables) {
			const sheet = workbook.addWorksheet(this.sheetName(table.title))
			sheet.addRow(table.columns)
			sheet.getRow(1).font = { bold: true, color: { argb: `FF${HEADING_COLOR}` } }
			for (const row of table.rows) sheet.addRow(row)
			sheet.columns.forEach(column => {
				column.width = 24
			})
		}

		const buffer = await workbook.xlsx.writeBuffer()
		return Buffer.from(buffer)
	}

	/** Excel refuses a sheet name over 31 characters or carrying []:*?/\ */
	private sheetName(title: string): string {
		return title.replace(/[[\]:*?/\\]/g, " ").slice(0, 31)
	}

	private async toWordDocument(
		run: ReportRun,
		header: [string, string][],
		tables: ReportTable[],
		note: string | null
	): Promise<Buffer> {
		const children: (Paragraph | Table)[] = [
			new Paragraph({
				heading: HeadingLevel.HEADING_1,
				children: [new TextRun({ text: run.definitionName, color: HEADING_COLOR })],
			}),
			this.wordTable(["Field", "Value"], header.map(([field, value]) => [field, value])),
		]

		if (note) {
			children.push(
				new Paragraph({
					spacing: { before: 240 },
					children: [new TextRun({ text: `Figures withheld: ${note}`, italics: true })],
				})
			)
		}

		for (const table of tables) {
			children.push(
				new Paragraph({
					heading: HeadingLevel.HEADING_2,
					spacing: { before: 240 },
					children: [new TextRun({ text: table.title, color: HEADING_COLOR })],
				})
			)
			children.push(this.wordTable(table.columns, table.rows))
		}

		const document = new Document({ sections: [{ children }] })
		return Packer.toBuffer(document)
	}

	private wordTable(columns: string[], rows: (string | number)[][]): Table {
		return new Table({
			width: { size: 100, type: WidthType.PERCENTAGE },
			rows: [
				new TableRow({
					tableHeader: true,
					children: columns.map(
						column =>
							new TableCell({
								children: [
									new Paragraph({
										children: [new TextRun({ text: column, bold: true })],
									}),
								],
							})
					),
				}),
				...rows.map(
					row =>
						new TableRow({
							children: row.map(
								cell =>
									new TableCell({
										children: [new Paragraph({ text: String(cell) })],
									})
							),
						})
				),
			],
		})
	}

	private toPdf(
		run: ReportRun,
		header: [string, string][],
		tables: ReportTable[],
		note: string | null
	): Promise<Buffer> {
		return new Promise((resolve, reject) => {
			const document = new PDFDocument({ size: "A4", margin: 48 })
			const chunks: Buffer[] = []
			document.on("data", (chunk: Buffer) => chunks.push(chunk))
			document.on("end", () => resolve(Buffer.concat(chunks)))
			document.on("error", reject)

			document
				.fillColor(`#${HEADING_COLOR}`)
				.fontSize(18)
				.text(run.definitionName, { align: "left" })
			document.moveDown(0.5).fillColor("#000000").fontSize(10)
			for (const [field, value] of header) {
				document.font("Helvetica-Bold").text(`${field}: `, { continued: true })
				document.font("Helvetica").text(value)
			}
			if (note) {
				document.moveDown(0.5).font("Helvetica-Oblique").text(`Figures withheld: ${note}`)
			}

			for (const table of tables) {
				document.moveDown(1)
				document
					.fillColor(`#${HEADING_COLOR}`)
					.font("Helvetica-Bold")
					.fontSize(13)
					.text(table.title)
				document.moveDown(0.3).fillColor("#000000").fontSize(9)
				document.font("Helvetica-Bold").text(table.columns.join("  |  "))
				document.font("Helvetica")
				for (const row of table.rows) {
					document.text(row.map(cell => String(cell)).join("  |  "))
				}
			}

			document.end()
		})
	}
}
