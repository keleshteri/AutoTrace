import { describe, expect, it } from "vitest";
import { formatElapsed } from "./api";
import {
  displaySecs,
  ringProgressPct,
  sessionCaption,
} from "./timerDisplay";

describe("formatElapsed", () => {
  it("formats under an hour as m:ss", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(8 * 60 + 26)).toBe("8:26");
    expect(formatElapsed(59 * 60 + 59)).toBe("59:59");
  });

  it("formats hours as h:mm:ss", () => {
    expect(formatElapsed(3600)).toBe("1:00:00");
    expect(formatElapsed(122 * 60 + 3)).toBe("2:02:03");
  });

  it("floors negatives to zero", () => {
    expect(formatElapsed(-5)).toBe("0:00");
  });
});

describe("sessionCaption", () => {
  it("shows since-break when idle", () => {
    expect(sessionCaption(null, true)).toBe("Time since last break");
    expect(sessionCaption(null, false)).toBe("Ready");
  });

  it("labels active and paused kinds", () => {
    expect(
      sessionCaption({ status: "active", kind: "focus", elapsed_secs: 10 }, false),
    ).toBe("Focus time elapsed");
    expect(
      sessionCaption({ status: "paused", kind: "meeting" }, false),
    ).toBe("Meeting paused");
    expect(
      sessionCaption({ status: "active", kind: "break", planned_secs: 300 }, false),
    ).toBe("Break remaining");
  });
});

describe("displaySecs", () => {
  it("uses since-break when no focus", () => {
    expect(displaySecs(null, 506)).toBe(506);
  });

  it("counts down break remaining", () => {
    expect(
      displaySecs(
        { status: "active", kind: "break", planned_secs: 300, elapsed_secs: 40 },
        0,
      ),
    ).toBe(260);
  });

  it("shows elapsed for focus", () => {
    expect(
      displaySecs(
        { status: "active", kind: "focus", planned_secs: 3000, elapsed_secs: 90 },
        999,
      ),
    ).toBe(90);
  });
});

describe("ringProgressPct", () => {
  it("fills from elapsed against default focus length", () => {
    const pct = ringProgressPct(
      { status: "active", kind: "focus", elapsed_secs: 25 * 60 },
      25 * 60,
      50,
    );
    expect(pct).toBe(50);
  });

  it("fills as break time is consumed", () => {
    const remaining = 150;
    const pct = ringProgressPct(
      { status: "active", kind: "break", planned_secs: 300, elapsed_secs: 150 },
      remaining,
      50,
    );
    expect(pct).toBe(50);
  });
});
