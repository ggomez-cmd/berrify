import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  verifyOtp: vi.fn(),
  getSession: vi.fn(),
  updateUser: vi.fn(),
}));
const rpc = vi.hoisted(() => vi.fn());
vi.mock("../../lib/supabase", () => ({ supabase: { auth, rpc } }));
const navigate = vi.hoisted(() => vi.fn());
vi.mock("react-router-dom", async (orig) => ({
  ...(await orig<typeof import("react-router-dom")>()),
  useNavigate: () => navigate,
}));

import { AcceptInvitePage } from "./AcceptInvitePage";

const SUBMIT = { name: "Crear cuenta" };

function renderAt(search: string) {
  window.history.replaceState(null, "", `/accept-invite${search}`);
  return render(
    <MemoryRouter>
      <AcceptInvitePage />
    </MemoryRouter>,
  );
}

function pinRpc(setResult: string) {
  return async (name: string) =>
    name === "my_clock_pin_status" ? { data: [{ has_pin: false }], error: null } : { data: setResult, error: null };
}

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe("AcceptInvitePage", () => {
  const signedIn = { data: { session: { user: { id: "u1", email: "ana@example.com" } } } };

  beforeEach(() => {
    vi.clearAllMocks();
    auth.getSession.mockResolvedValue({ data: { session: null } });
    auth.updateUser.mockResolvedValue({ error: null });
    rpc.mockImplementation(pinRpc("set"));
  });

  async function fillForm(pin = "4821") {
    auth.getSession.mockResolvedValue(signedIn);
    renderAt("");
    await screen.findByRole("button", SUBMIT);
    fill("Contraseña", "secret1");
    fill("Confirmar contraseña", "secret1");
    fill("PIN del kiosco", pin);
    fill("Confirmar PIN", pin);
  }

  it("verifies the token once and shows the form for the invited account", async () => {
    auth.verifyOtp.mockImplementation(async () => {
      auth.getSession.mockResolvedValue(signedIn);
      return { data: { user: { id: "u1" } }, error: null };
    });
    renderAt("?token_hash=abc&type=invite");
    expect(await screen.findByRole("button", SUBMIT)).toBeTruthy();
    expect(screen.getByText(/ana@example.com/)).toBeTruthy();
    expect(auth.verifyOtp).toHaveBeenCalledTimes(1);
    expect(auth.verifyOtp).toHaveBeenCalledWith({ token_hash: "abc", type: "invite" });
    expect(window.location.search).toBe("");
  });

  it("keeps the form after a refresh while the invited user is signed in", async () => {
    auth.getSession.mockResolvedValue(signedIn);
    renderAt("");
    expect(await screen.findByRole("button", SUBMIT)).toBeTruthy();
  });

  it("never falls back to another signed-in account when the link fails", async () => {
    auth.getSession.mockResolvedValue(signedIn);
    auth.verifyOtp.mockResolvedValue({ data: { user: null }, error: new Error("expired") });
    renderAt("?token_hash=abc&type=invite");
    expect(await screen.findByRole("link", { name: "¿Olvidaste tu contraseña?" })).toBeTruthy();
    expect(screen.queryByRole("button", SUBMIT)).toBeNull();
  });

  it("offers password recovery when signed out and the link is used up", async () => {
    auth.verifyOtp.mockResolvedValue({ data: { user: null }, error: new Error("expired") });
    renderAt("?token_hash=abc&type=invite");
    expect(await screen.findByRole("link", { name: "¿Olvidaste tu contraseña?" })).toBeTruthy();
  });

  it("stops with an error when the PIN status cannot load", async () => {
    auth.getSession.mockResolvedValue(signedIn);
    rpc.mockResolvedValue({ data: null, error: new Error("down") });
    renderAt("");
    expect(await screen.findByText(/No pudimos cargar tu cuenta/)).toBeTruthy();
    expect(screen.queryByRole("button", SUBMIT)).toBeNull();
  });

  it("sets the kiosk PIN and then the password", async () => {
    await fillForm();
    fireEvent.click(screen.getByRole("button", SUBMIT));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/", { replace: true }));
    expect(rpc).toHaveBeenCalledWith("set_my_clock_pin", { pin: "4821" });
    expect(auth.updateUser).toHaveBeenCalledWith({ password: "secret1" });
  });

  it("asks for another PIN when it is taken and keeps the password unset", async () => {
    rpc.mockImplementation(pinRpc("taken"));
    await fillForm();
    fireEvent.click(screen.getByRole("button", SUBMIT));
    expect(await screen.findByText("Ese PIN no está disponible. Escoge otro.")).toBeTruthy();
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("lets the employee finish with only a password after too many taken PINs", async () => {
    rpc.mockImplementation(pinRpc("locked"));
    await fillForm();
    fireEvent.click(screen.getByRole("button", SUBMIT));
    expect(await screen.findByText(/Tu gerente asignará tu PIN/)).toBeTruthy();
    expect(screen.queryByLabelText("PIN del kiosco")).toBeNull();
    fireEvent.click(screen.getByRole("button", SUBMIT));
    await waitFor(() => expect(auth.updateUser).toHaveBeenCalledWith({ password: "secret1" }));
  });

  it("rejects a short PIN before calling the server", async () => {
    await fillForm("12");
    fireEvent.click(screen.getByRole("button", SUBMIT));
    expect(await screen.findByText("El PIN debe tener de 4 a 8 dígitos.")).toBeTruthy();
    expect(rpc).not.toHaveBeenCalledWith("set_my_clock_pin", expect.anything());
  });

  it("skips the PIN when the employee already has one", async () => {
    rpc.mockResolvedValue({ data: [{ has_pin: true }], error: null });
    auth.getSession.mockResolvedValue(signedIn);
    renderAt("");
    await screen.findByRole("button", SUBMIT);
    expect(screen.queryByLabelText("PIN del kiosco")).toBeNull();
  });
});
