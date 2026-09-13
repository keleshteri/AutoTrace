import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TimerView } from "../components/TimerView";
import type { FocusSession } from "./api";

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return {
    ...actual,
    api: {
      listPlannedForDay: vi.fn(async () => []),
      planPomodoro: vi.fn(async () => []),
      clearPlannedForDay: vi.fn(async () => 0),
      startFocus: vi.fn(),
      pauseFocus: vi.fn(),
      resumeFocus: vi.fn(),
      endFocus: vi.fn(),
      extendFocus: vi.fn(),
      getFeatureFlag: vi.fn(async () => "50"),
    },
  };
});

describe("TimerView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows since-break clock when idle", async () => {
    render(
      <TimerView
        focus={null}
        hierarchy={{ clients: [] }}
        sinceBreakSecs={8 * 60 + 26}
        focusDefaultMins={50}
        onChanged={() => undefined}
        onError={() => undefined}
        onOpenActivity={() => undefined}
      />,
    );
    expect(await screen.findByText("Time since last break")).toBeTruthy();
    expect(screen.getByText("8:26")).toBeTruthy();
  });

  it("shows focus elapsed when a session is active", async () => {
    const focus: FocusSession = {
      id: 1,
      goal: "Ship",
      client_id: null,
      project_id: null,
      task_id: null,
      client_name: null,
      project_name: null,
      task_name: null,
      started_at: "2026-09-12T10:00:00",
      ended_at: null,
      status: "active",
      elapsed_secs: 90,
      kind: "focus",
      planned_secs: 3000,
      category_override: null,
    };
    render(
      <TimerView
        focus={focus}
        hierarchy={{ clients: [] }}
        sinceBreakSecs={999}
        focusDefaultMins={50}
        onChanged={() => undefined}
        onError={() => undefined}
        onOpenActivity={() => undefined}
      />,
    );
    expect(await screen.findByText("Focus time elapsed")).toBeTruthy();
    expect(screen.getByText("1:30")).toBeTruthy();
  });
});
