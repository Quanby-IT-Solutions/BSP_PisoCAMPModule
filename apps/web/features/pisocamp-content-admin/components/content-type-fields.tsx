import type { PisoCampContentType } from "@repo/contracts"

import { Field, FieldError, FieldGroup, FieldLabel } from "@/core/components/ui/field"
import { Input } from "@/core/components/ui/input"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/core/components/ui/select"
import { Textarea } from "@/core/components/ui/textarea"
import {
	changeContentType,
	changeCurrencySeries,
	getDenominationOptions,
	getSeriesOptions,
	type ContentFormErrors,
	type ContentFormValues,
} from "@/features/pisocamp-content-admin/lib/content-form"

const CONTENT_TYPE_OPTIONS: readonly { value: PisoCampContentType; label: string }[] = [
	{ value: "advisory", label: "Advisory" },
	{ value: "banknote", label: "Banknote" },
	{ value: "coin", label: "Coin" },
	{ value: "security_feature", label: "Security feature" },
	{ value: "link", label: "Link" },
]

const REFLOW_SELECT_TRIGGER_CLASS =
	"h-auto min-h-8 w-full max-w-full min-w-0 whitespace-normal py-2"
const REFLOW_SELECT_VALUE_CLASS = "min-w-0 whitespace-normal break-words line-clamp-none"

function isContentType(value: unknown): value is PisoCampContentType {
	return CONTENT_TYPE_OPTIONS.some(option => option.value === value)
}

interface ContentTypeFieldsProps {
	values: ContentFormValues
	errors: ContentFormErrors
	titleRef: React.RefObject<HTMLInputElement | null>
	summaryRef: React.RefObject<HTMLInputElement | null>
	bodyRef: React.RefObject<HTMLTextAreaElement | null>
	primaryUrlRef: React.RefObject<HTMLInputElement | null>
	seriesRef: React.RefObject<HTMLButtonElement | null>
	featureLevelRef: React.RefObject<HTMLButtonElement | null>
	hotspotRef: React.RefObject<HTMLInputElement | null>
	denominationRef: React.RefObject<HTMLButtonElement | null>
	onChange: (values: ContentFormValues) => void
}

export function ContentTypeFields({
	values,
	errors,
	titleRef,
	summaryRef,
	bodyRef,
	primaryUrlRef,
	seriesRef,
	featureLevelRef,
	hotspotRef,
	denominationRef,
	onChange,
}: ContentTypeFieldsProps) {
	const set = (key: keyof ContentFormValues, value: string) => onChange({ ...values, [key]: value })
	const currency = ["banknote", "coin", "security_feature"].includes(values.contentType)

	return (
		<FieldGroup className="w-full max-w-full min-w-0">
			<Field className="max-w-full min-w-0">
				<FieldLabel htmlFor="content-type">Content type</FieldLabel>
				<Select
					name="contentType"
					value={values.contentType}
					onValueChange={value => {
						if (isContentType(value)) onChange(changeContentType(values, value))
					}}
				>
					<SelectTrigger id="content-type" wrapValue className={REFLOW_SELECT_TRIGGER_CLASS}>
						<SelectValue className={REFLOW_SELECT_VALUE_CLASS}>
							{CONTENT_TYPE_OPTIONS.find(option => option.value === values.contentType)?.label}
						</SelectValue>
					</SelectTrigger>
					<SelectContent>
						{CONTENT_TYPE_OPTIONS.map(option => (
							<SelectItem key={option.value} value={option.value}>
								{option.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</Field>

			<TextField
				id="title"
				label="Title"
				value={values.title}
				error={errors.title}
				inputRef={titleRef}
				onChange={value => set("title", value)}
			/>
			<TextField
				id="summary"
				label="Summary"
				value={values.summary}
				error={errors.summary}
				inputRef={summaryRef}
				onChange={value => set("summary", value)}
			/>
			<Field className="max-w-full min-w-0">
				<FieldLabel htmlFor="body">
					Body{values.contentType === "link" ? " (optional)" : ""}
				</FieldLabel>
				<Textarea
					ref={bodyRef}
					id="body"
					name="body"
					autoComplete="off"
					rows={8}
					value={values.body}
					onChange={event => set("body", event.target.value)}
					aria-invalid={errors.body ? true : undefined}
					aria-describedby={errors.body ? "body-error" : undefined}
					className="max-w-full min-w-0"
				/>
				<FieldError id="body-error">{errors.body}</FieldError>
			</Field>

			{currency ? (
				<div className="grid w-full max-w-full min-w-0 gap-4 sm:grid-cols-2">
					<Field className="max-w-full min-w-0">
						<FieldLabel htmlFor="series-code">Currency series</FieldLabel>
						<Select
							name="seriesCode"
							value={values.seriesCode || null}
							onValueChange={value => {
								if (typeof value === "string") onChange(changeCurrencySeries(values, value))
							}}
						>
							<SelectTrigger
								ref={seriesRef}
								id="series-code"
								wrapValue
								className={REFLOW_SELECT_TRIGGER_CLASS}
								aria-invalid={errors.seriesCode ? true : undefined}
								aria-describedby={errors.seriesCode ? "series-code-error" : undefined}
							>
								<SelectValue className={REFLOW_SELECT_VALUE_CLASS}>
									{getSeriesOptions(values.contentType).find(
										option => option.code === values.seriesCode
									)?.label ?? "Select a series"}
								</SelectValue>
							</SelectTrigger>
							<SelectContent>
								{getSeriesOptions(values.contentType).map(option => (
									<SelectItem key={option.code} value={option.code}>
										{option.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<FieldError id="series-code-error">{errors.seriesCode}</FieldError>
					</Field>
					<Field className="max-w-full min-w-0">
						<FieldLabel htmlFor="denomination-code">Denomination</FieldLabel>
						<Select
							name="denominationCode"
							value={values.denominationCode || null}
							onValueChange={value => {
								if (typeof value === "string") set("denominationCode", value)
							}}
							disabled={!values.seriesCode}
						>
							<SelectTrigger
								ref={denominationRef}
								id="denomination-code"
								wrapValue
								className={REFLOW_SELECT_TRIGGER_CLASS}
								aria-invalid={errors.denominationCode ? true : undefined}
								aria-describedby={errors.denominationCode ? "denomination-code-error" : undefined}
							>
								<SelectValue className={REFLOW_SELECT_VALUE_CLASS}>
									{getDenominationOptions(values.seriesCode).find(
										option => option.code === values.denominationCode
									)?.label ?? "Select a denomination"}
								</SelectValue>
							</SelectTrigger>
							<SelectContent>
								{getDenominationOptions(values.seriesCode).map(option => (
									<SelectItem key={option.code} value={option.code}>
										{option.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<FieldError id="denomination-code-error">{errors.denominationCode}</FieldError>
					</Field>
				</div>
			) : null}

			{values.contentType === "security_feature" ? (
				<div className="grid w-full max-w-full min-w-0 gap-4 sm:grid-cols-2">
					<Field className="max-w-full min-w-0">
						<FieldLabel htmlFor="feature-level">Disclosure level</FieldLabel>
						<Select
							name="featureLevel"
							value={values.featureLevel || null}
							onValueChange={value => {
								if (typeof value !== "string") return
								// A second-level feature never reaches a device, so any
								// hotspot recorded for it is dropped with the change.
								onChange({
									...values,
									featureLevel: value as ContentFormValues["featureLevel"],
									...(value === "second" ? { hotspotX: "", hotspotY: "" } : {}),
								})
							}}
						>
							<SelectTrigger
								ref={featureLevelRef}
								id="feature-level"
								wrapValue
								className={REFLOW_SELECT_TRIGGER_CLASS}
								aria-invalid={errors.featureLevel ? true : undefined}
								aria-describedby={
									errors.featureLevel ? "feature-level-error" : "feature-level-help"
								}
							>
								<SelectValue className={REFLOW_SELECT_VALUE_CLASS}>
									{values.featureLevel === "first"
										? "First level — shown to the public"
										: values.featureLevel === "second"
											? "Second level — withheld from the app"
											: "Select a level"}
								</SelectValue>
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="first">First level — shown to the public</SelectItem>
								<SelectItem value="second">Second level — withheld from the app</SelectItem>
							</SelectContent>
						</Select>
						<p id="feature-level-help" className="text-muted-foreground text-sm">
							A second-level feature is left out of the offline bundle entirely, so it never
							reaches a device.
						</p>
						<FieldError id="feature-level-error">{errors.featureLevel}</FieldError>
					</Field>
					{values.featureLevel === "first" ? (
						<Field className="max-w-full min-w-0">
							<FieldLabel htmlFor="hotspot-x">Hotspot position (optional)</FieldLabel>
							<div className="flex max-w-full min-w-0 gap-3">
								<Input
									ref={hotspotRef}
									id="hotspot-x"
									name="hotspotX"
									type="number"
									inputMode="numeric"
									min={0}
									max={1000}
									step={1}
									placeholder="Across"
									aria-label="Hotspot position across the image, in permille"
									className="min-h-11 min-w-0"
									value={values.hotspotX}
									onChange={event => set("hotspotX", event.target.value)}
									aria-invalid={errors.hotspot ? true : undefined}
									aria-describedby={errors.hotspot ? "hotspot-error" : "hotspot-help"}
								/>
								<Input
									id="hotspot-y"
									name="hotspotY"
									type="number"
									inputMode="numeric"
									min={0}
									max={1000}
									step={1}
									placeholder="Down"
									aria-label="Hotspot position down the image, in permille"
									className="min-h-11 min-w-0"
									value={values.hotspotY}
									onChange={event => set("hotspotY", event.target.value)}
									aria-invalid={errors.hotspot ? true : undefined}
									aria-describedby={errors.hotspot ? "hotspot-error" : "hotspot-help"}
								/>
							</div>
							<p id="hotspot-help" className="text-muted-foreground text-sm">
								Thousandths of the image, measured from its top-left corner. Leave both blank
								for no marker.
							</p>
							<FieldError id="hotspot-error">{errors.hotspot}</FieldError>
						</Field>
					) : null}
				</div>
			) : null}

			{values.contentType === "link" ? (
				<TextField
					id="primary-url"
					label="Primary URL"
					type="url"
					value={values.primaryUrl}
					error={errors.primaryUrl}
					inputRef={primaryUrlRef}
					onChange={value => set("primaryUrl", value)}
				/>
			) : null}
		</FieldGroup>
	)
}

function TextField({
	id,
	label,
	type = "text",
	value,
	error,
	inputRef,
	onChange,
}: {
	id: string
	label: string
	type?: string
	value: string
	error?: string
	inputRef?: React.RefObject<HTMLInputElement | HTMLTextAreaElement | null>
	onChange: (value: string) => void
}) {
	return (
		<Field className="max-w-full min-w-0">
			<FieldLabel htmlFor={id}>{label}</FieldLabel>
			<Input
				ref={inputRef as React.RefObject<HTMLInputElement | null>}
				id={id}
				name={id}
				type={type}
				autoComplete="off"
				value={value}
				onChange={event => onChange(event.target.value)}
				aria-invalid={error ? true : undefined}
				aria-describedby={error ? `${id}-error` : undefined}
				className="max-w-full min-w-0"
			/>
			<FieldError id={`${id}-error`}>{error}</FieldError>
		</Field>
	)
}
