import { Button } from "@/core/components/ui/button"
import { Field, FieldError, FieldLabel, FieldSet } from "@/core/components/ui/field"
import { Input } from "@/core/components/ui/input"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/core/components/ui/select"
import type {
	ContentFormValues,
	RelatedLinkFormValue,
} from "@/features/pisocamp-content-admin/lib/content-form"

interface RelatedLinksEditorProps {
	values: ContentFormValues
	errors: Record<string, string>
	onControlRef: (key: string, element: HTMLElement | null) => void
	onChange: (links: RelatedLinkFormValue[]) => void
}

const LINK_KIND_OPTIONS: readonly { value: RelatedLinkFormValue["kind"]; label: string }[] = [
	{ value: "external", label: "External URL" },
	{ value: "internal", label: "Internal route" },
	{ value: "topic", label: "Content topic" },
]

const REFLOW_SELECT_TRIGGER_CLASS =
	"h-auto min-h-8 w-full max-w-full min-w-0 whitespace-normal py-2"
const REFLOW_SELECT_VALUE_CLASS = "min-w-0 whitespace-normal break-words line-clamp-none"
const REFLOW_ACTION_CLASS = "h-auto min-h-7 w-full whitespace-normal sm:w-auto"

function isRelatedLinkKind(value: unknown): value is RelatedLinkFormValue["kind"] {
	return LINK_KIND_OPTIONS.some(option => option.value === value)
}

export function RelatedLinksEditor({
	values,
	errors,
	onControlRef,
	onChange,
}: RelatedLinksEditorProps) {
	const update = (index: number, patch: Partial<RelatedLinkFormValue>) =>
		onChange(
			values.relatedLinks.map((link, position) =>
				position === index ? { ...link, ...patch } : link
			)
		)
	const move = (from: number, to: number) => {
		const links = [...values.relatedLinks]
		const [link] = links.splice(from, 1)
		if (!link) return
		links.splice(to, 0, link)
		onChange(links)
	}

	return (
		<FieldSet className="w-full max-w-full min-w-0 rounded-lg border p-[8px] sm:p-4">
			<legend className="font-medium break-words">Related links</legend>
			{values.relatedLinks.map((link, index) => {
				const labelError = errors[`relatedLinks.${index}.label`]
				const valueError = errors[`relatedLinks.${index}.value`]
				const rowLabel = `Related link ${index + 1}`
				return (
					<FieldSet
						key={link.clientId}
						className="bg-muted/30 grid w-full max-w-full min-w-0 gap-3 rounded-lg p-[8px] sm:p-3"
					>
						<legend className="text-sm font-medium break-words">{rowLabel}</legend>
						<div className="grid w-full max-w-full min-w-0 gap-3 sm:grid-cols-3">
							<Field className="max-w-full min-w-0">
								<FieldLabel htmlFor={`link-kind-${link.clientId}`}>Link kind</FieldLabel>
								<Select
									name={`relatedLinks.${index}.kind`}
									value={link.kind}
									onValueChange={value => {
										if (isRelatedLinkKind(value)) update(index, { kind: value, value: "" })
									}}
								>
									<SelectTrigger
										id={`link-kind-${link.clientId}`}
										wrapValue
										className={REFLOW_SELECT_TRIGGER_CLASS}
									>
										<SelectValue className={REFLOW_SELECT_VALUE_CLASS}>
											{LINK_KIND_OPTIONS.find(option => option.value === link.kind)?.label}
										</SelectValue>
									</SelectTrigger>
									<SelectContent>
										{LINK_KIND_OPTIONS.map(option => (
											<SelectItem key={option.value} value={option.value}>
												{option.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</Field>
							<Field className="max-w-full min-w-0">
								<FieldLabel htmlFor={`link-label-${link.clientId}`}>Link label</FieldLabel>
								<Input
									ref={element => onControlRef(`relatedLinks.${index}.label`, element)}
									id={`link-label-${link.clientId}`}
									name={`relatedLinks.${index}.label`}
									autoComplete="off"
									value={link.label}
									onChange={event => update(index, { label: event.target.value })}
									aria-invalid={labelError ? true : undefined}
									aria-describedby={labelError ? `link-label-${link.clientId}-error` : undefined}
									className="max-w-full min-w-0"
								/>
								<FieldError id={`link-label-${link.clientId}-error`}>{labelError}</FieldError>
							</Field>
							<Field className="max-w-full min-w-0">
								<FieldLabel htmlFor={`link-value-${link.clientId}`}>
									{link.kind === "external"
										? "HTTPS URL"
										: link.kind === "internal"
											? "Internal route"
											: "Content item ID"}
								</FieldLabel>
								<Input
									ref={element => onControlRef(`relatedLinks.${index}.value`, element)}
									id={`link-value-${link.clientId}`}
									name={`relatedLinks.${index}.value`}
									autoComplete="off"
									type={link.kind === "external" ? "url" : "text"}
									spellCheck={link.kind === "external" ? undefined : false}
									value={link.value}
									onChange={event => update(index, { value: event.target.value })}
									aria-invalid={valueError ? true : undefined}
									aria-describedby={valueError ? `link-value-${link.clientId}-error` : undefined}
									className="max-w-full min-w-0"
								/>
								<FieldError id={`link-value-${link.clientId}-error`}>{valueError}</FieldError>
							</Field>
						</div>
						<div className="grid w-full min-w-0 gap-2 sm:flex sm:flex-wrap">
							<Button
								type="button"
								variant="outline"
								size="sm"
								aria-label={`Move ${rowLabel} up`}
								disabled={index === 0}
								onClick={() => move(index, index - 1)}
								className={REFLOW_ACTION_CLASS}
							>
								Move Up
							</Button>
							<Button
								type="button"
								variant="outline"
								size="sm"
								aria-label={`Move ${rowLabel} down`}
								disabled={index === values.relatedLinks.length - 1}
								onClick={() => move(index, index + 1)}
								className={REFLOW_ACTION_CLASS}
							>
								Move Down
							</Button>
							<Button
								type="button"
								variant="destructive"
								size="sm"
								aria-label={`Remove ${rowLabel}`}
								className={REFLOW_ACTION_CLASS}
								onClick={() =>
									onChange(values.relatedLinks.filter((_, position) => position !== index))
								}
							>
								Remove
							</Button>
						</div>
					</FieldSet>
				)
			})}
			<Button
				type="button"
				variant="outline"
				className="h-auto min-h-8 w-full whitespace-normal sm:w-fit"
				disabled={values.relatedLinks.length >= 10}
				onClick={() =>
					onChange([
						...values.relatedLinks,
						{ clientId: crypto.randomUUID(), kind: "external", label: "", value: "" },
					])
				}
			>
				Add Related Link
			</Button>
		</FieldSet>
	)
}
