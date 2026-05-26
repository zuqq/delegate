import { type Static, Type } from "typebox";

export const ParamsSchema = Type.Object({
	agent: Type.String({
		description: "Name of the agent to invoke; must match one of the available agents.",
		minLength: 1,
	}),
	task: Type.String({
		description: "A description of the task, sent to the subagent as its user prompt.",
		minLength: 1,
	}),
	description: Type.String({
		description: "A short description of the task, used to identify this subagent call in the transcript.",
		minLength: 1,
	}),
});

export type Params = Static<typeof ParamsSchema>;
