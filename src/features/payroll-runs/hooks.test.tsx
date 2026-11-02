import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { useApprovePayrollRun, useSavePayrollRunDraft } from "./hooks";

const rpc = vi.fn();
vi.mock("../../lib/supabase", () => ({ supabase: { rpc: (...args: unknown[]) => rpc(...args) } }));

const staleError = { message: "shifts changed since this run was calculated: stale, recalculate" };

function setup() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const reloadedShifts = () =>
    invalidate.mock.calls.some(([filters]) => filters?.queryKey?.[0] === "payroll_run_time_entries");
  return { wrapper, reloadedShifts };
}

describe("shift-stale recovery", () => {
  it("reloads the run's shifts after a rejected draft save, so Recalculate uses fresh ones", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: staleError });
    const { wrapper, reloadedShifts } = setup();
    const { result } = renderHook(() => useSavePayrollRunDraft(), { wrapper });
    await expect(
      result.current.mutateAsync({ runId: null, run: {} as never, checks: [] }),
    ).rejects.toThrow(/shifts changed/);
    await waitFor(() => expect(reloadedShifts()).toBe(true));
  });

  it("reloads the run's shifts after a rejected approve", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: staleError });
    const { wrapper, reloadedShifts } = setup();
    const { result } = renderHook(() => useApprovePayrollRun(), { wrapper });
    await expect(result.current.mutateAsync("run-1")).rejects.toThrow(/shifts changed/);
    await waitFor(() => expect(reloadedShifts()).toBe(true));
  });
});
