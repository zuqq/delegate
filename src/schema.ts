import { type Static, Type } from "typebox";

export const ParamsSchema = Type.Object({
	task: Type.String({
		description: "The task for the subagent to perform. It shares no history, so include everything it needs.",
		minLength: 1,
	}),
	description: Type.String({
		description: "A short description of the task, used to identify this subagent call in the transcript.",
		minLength: 1,
	}),
});

export type Params = Static<typeof ParamsSchema>;
