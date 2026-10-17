import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import { VaultGate } from "./VaultGate";

vi.mock("../lib/api", () => ({
  api: {
    vaultStatus: vi.fn(),
    unlockDatabase: vi.fn(),
  },
}));

const mocked = vi.mocked(api);

describe("VaultGate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(cleanup);

  it("renders the app when the database is not locked", async () => {
    mocked.vaultStatus.mockResolvedValue({ vault_exists: false, locked: false, db_encryption: null });
    render(<VaultGate><p>app body</p></VaultGate>);
    expect(await screen.findByText("app body")).toBeTruthy();
  });

  it("does not block the app if the status check fails", async () => {
    mocked.vaultStatus.mockRejectedValue(new Error("no backend"));
    render(<VaultGate><p>app body</p></VaultGate>);
    expect(await screen.findByText("app body")).toBeTruthy();
  });

  it("asks for the passphrase and shows errors until unlocked", async () => {
    mocked.vaultStatus.mockResolvedValue({ vault_exists: true, locked: true, db_encryption: null });
    mocked.unlockDatabase
      .mockRejectedValueOnce("wrong passphrase or corrupt vault")
      .mockResolvedValueOnce(undefined);
    render(<VaultGate><p>app body</p></VaultGate>);

    const input = await screen.findByLabelText("Passphrase");
    fireEvent.change(input, { target: { value: "not it!!" } });
    fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "wrong passphrase or corrupt vault",
    );
    expect(screen.queryByText("app body")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
    await waitFor(() => expect(screen.getByText("app body")).toBeTruthy());
    expect(mocked.unlockDatabase).toHaveBeenCalledWith("not it!!");
  });
});
