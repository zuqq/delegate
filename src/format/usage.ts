function stripZeroFraction(s: string): string {
	return s.replace(/\.0+$/, "");
}

/**
 * Format a token count with k/M suffixes.
 *
 * @example
 * formatTokenCount(999);       // "999"
 * formatTokenCount(1_500);     // "1.5k"
 * formatTokenCount(200_000);   // "200k"
 * formatTokenCount(1_500_000); // "1.5M"
 */
export function formatTokenCount(count: number): string {
	if (count < 1_000) return count.toString();
	// We need to round before checking against the M threshold, so that 999_950
	// results in "1M" instead of "1000k". Use Math.round instead of toFixed so
	// that we stay in number space until the very end.
	const k = Math.round(count / 100) / 10;
	if (k < 1_000) return `${stripZeroFraction(k.toFixed(1))}k`;
	const m = Math.round(count / 100_000) / 10;
	return `${stripZeroFraction(m.toFixed(1))}M`;
}

/**
 * Format a USD cost with up to 4 decimals.
 *
 * @example
 * formatCost(0.187);  // "$0.19"
 * formatCost(0.004);  // "$0.004"
 * formatCost(0.0001); // "$0.0001"
 */
export function formatCost(cost: number): string {
	const two = cost.toFixed(2);
	if (cost === 0 || two !== "0.00") return `$${two}`;
	const three = cost.toFixed(3);
	if (three !== "0.000") return `$${three}`;
	return `$${cost.toFixed(4)}`;
}
