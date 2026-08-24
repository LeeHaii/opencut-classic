export interface AgentTurn {
	/** Final assistant text (HTML fence stripped by callers when composing). */
	text: string
	conversationId?: string
	usage?: unknown
	fallbackText: boolean
}

export interface AgentChatMessage {
	id: string
	role: "user" | "assistant" | "system"
	text: string
	createdAt: string
	/** Inline image references (data URLs) attached to this turn. */
	images?: string[]
}

export interface AntigravityStatus {
	installed: boolean
	executablePath?: string | null
	version?: string | null
	minimumVersionMet: boolean
	accountEmail?: string | null
	accountPlan?: string | null
}
