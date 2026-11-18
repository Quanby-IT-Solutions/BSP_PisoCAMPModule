"use client"

import * as React from "react"
import type { Route } from "next"
import Image from "next/image"
import Link from "next/link"
import type { GitbookFreeIcons } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"

import { Button, buttonVariants, type ButtonVariants } from "@/core/components/ui/button"
import { cn } from "@/core/lib/utils"

export interface LogoIconProps extends Omit<
	React.ComponentPropsWithoutRef<typeof HugeiconsIcon>,
	"icon"
> {
	icon?: typeof GitbookFreeIcons
	strokeWidth?: number
	ref?: React.Ref<SVGSVGElement>
}

export const LogoIcon = React.memo(
	({ icon, strokeWidth = 2, className, ref, ...props }: LogoIconProps) => {
		// The BSP seal is the mark. An `icon` override still renders a glyph, so
		// callers that want something else are unaffected; the default is the
		// real artwork rather than a stand-in.
		if (!icon) {
			return (
				<Image
					src="/bsp-logo.png"
					alt=""
					aria-hidden
					width={24}
					height={24}
					className={cn("size-6 shrink-0 object-contain", className)}
					priority
				/>
			)
		}

		return (
			<HugeiconsIcon
				ref={ref}
				icon={icon}
				strokeWidth={strokeWidth}
				className={cn("text-primary", className)}
				{...props}
			/>
		)
	}
)
LogoIcon.displayName = "LogoIcon"

export interface LogoProps {
	text?: string
	href?: Route<string>
	showIcon?: boolean
	icon?: typeof GitbookFreeIcons
	strokeWidth?: number
	size?: ButtonVariants["size"]
	variant?: ButtonVariants["variant"]
	className?: string
}

export function Logo({
	text = "Piso CAMP",
	href,
	size = "lg",
	variant = "link",
	showIcon = true,
	icon,
	strokeWidth,
	className,
}: LogoProps) {
	const content = (
		<>
			{showIcon && <LogoIcon icon={icon} strokeWidth={strokeWidth} data-icon="inline-start" />}
			{text}
		</>
	)

	if (href) {
		return (
			<Link
				className={cn(buttonVariants({ size, variant }), "text-foreground", className)}
				href={href}
			>
				{content}
			</Link>
		)
	}

	return (
		<Button size={size} variant={variant} className={cn("text-foreground", className)}>
			{content}
		</Button>
	)
}
