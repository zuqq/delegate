import { describe, expect, it } from "vitest";
import { formatCost, formatDuration, formatTokenCount } from "../src/format.ts";

describe("formatCost", () => {
	it.each([
		[0.187, "$0.19"],
		[0.004, "$0.004"],
		[0.0001, "$0.0001"],
		[0, "$0.00"],
		[0.01, "$0.01"],
		[0.001, "$0.001"],
	] as const)("formatCost(%f) === %s", (input, expected) => {
		expect(formatCost(input)).toBe(expected);
	});
});

describe("formatTokenCount", () => {
	it.each([
		[0, "0"],
		[999, "999"],
		[1_000, "1k"],
		[1_500, "1.5k"],
		[9_999, "10k"],
		[10_000, "10k"],
		[12_345, "12.3k"],
		[99_999, "100k"],
		[200_000, "200k"],
		[999_499, "999.5k"],
		[999_500, "999.5k"],
		[999_949, "999.9k"],
		[999_950, "1M"],
		[999_999, "1M"],
		[1_000_000, "1M"],
		[1_500_000, "1.5M"],
		[9_999_999, "10M"],
		[10_000_000, "10M"],
		[99_999_999, "100M"],
	] as const)("formatTokenCount(%i) === %s", (input, expected) => {
		expect(formatTokenCount(input)).toBe(expected);
	});
});

describe("formatDuration", () => {
	it.each([
		[0, "0.0s"],
		[49, "0.0s"],
		[50, "0.1s"],
		[51, "0.1s"],
		[999, "1.0s"],
		[1_000, "1.0s"],
		[4_000, "4.0s"],
		[4_049, "4.0s"],
		[4_050, "4.1s"],
		[4_051, "4.1s"],
		[4_500, "4.5s"],
		[10_000, "10.0s"],
		[60_000, "60.0s"],
		[-500, "-0.5s"],
	] as const)("formatDuration(%i) === %s", (input, expected) => {
		expect(formatDuration(input)).toBe(expected);
	});
});
