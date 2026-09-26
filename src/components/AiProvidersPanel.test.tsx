import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import { AiProvidersPanel } from "./AiProvidersPanel";

vi.mock("../lib/api", () => ({
  api: {
    listAiProviders: vi.fn(),
    listAiBudgets: vi.fn(),
    getAiUsageSummary: vi.fn(),
    upsertAiProvider: vi.fn(),
    deleteAiProvider: vi.fn(),
    testAiProvider: vi.fn(),
    setAiBudget: vi.fn(),
  },
}));

const mocked = vi.mocked(api);

describe("AiProvidersPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.listAiProviders.mockResolvedValue([]);
    mocked.listAiBudgets.mockResolvedValue([]);
    mocked.getAiUsageSummary.mockResolvedValue({
      day_tokens: 0,
      day_requests: 0,
      month_tokens: 0,
      month_requests: 0,
      day_budget: null,
      month_budget: null,
      warn: false,
      blocked: false,
      recent: [],
    } as never);
  });
  afterEach(cleanup);

  it("shows an empty state and requires a key for cloud providers", async () => {
    render(<AiProvidersPanel onClose={() => {}} />);
    expect(await screen.findByText(/No providers yet/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "+ Add provider" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Work Claude" } });
    fireEvent.click(screen.getByRole("button", { name: "Save provider" }));

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Anthropic (Claude) needs an API key.",
    );
    expect(mocked.upsertAiProvider).not.toHaveBeenCalled();
  });

  it("saves a new provider with parsed models and makes the first one default", async () => {
    mocked.upsertAiProvider.mockResolvedValue({} as never);
    render(<AiProvidersPanel onClose={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "+ Add provider" }));

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Work Claude" } });
    fireEvent.change(screen.getByLabelText(/API key/), { target: { value: "sk-test" } });
    fireEvent.change(screen.getByLabelText(/Allowed models/), {
      target: { value: "claude-opus-5, claude-sonnet-5 ," },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save provider" }));

    await waitFor(() => expect(mocked.upsertAiProvider).toHaveBeenCalledTimes(1));
    expect(mocked.upsertAiProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        id: null,
        kind: "anthropic",
        label: "Work Claude",
        apiKey: "sk-test",
        isDefault: true,
        allowedModels: ["claude-opus-5", "claude-sonnet-5"],
        maxTokensPerRequest: 4096,
      }),
    );
  });
});
