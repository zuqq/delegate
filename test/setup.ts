import { initTheme } from "@earendil-works/pi-coding-agent";
import { setCapabilities } from "@earendil-works/pi-tui";

// `initTheme` consults terminal capabilities.
setCapabilities({ images: null, trueColor: false, hyperlinks: false });

// Pi's `theme` is a proxy that throws on access until `initTheme` runs.
initTheme("dark");
