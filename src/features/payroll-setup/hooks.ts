import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../auth/auth-context";
import { isAdmin } from "../../lib/schedule";
import { supabase } from "../../lib/supabase";
import { toThrownError } from "../../lib/thrown-error";
import type {
  PayrollCloverNameRow,
  PayrollEmployeeProfileRow,
  PayrollEmployerSettingsRow,
  PayrollOpeningBalanceWithTaxes,
  PayrollPayRateRow,
} from "../../lib/types";
import {
  findDuplicatePayRateError,
  toOpeningBalanceImportPayloads,
  type OpeningBalanceImportRow,
  type PayrollEmployeeSetupProfilePayload,
  type PayrollPayRateSetupPayload,
} from "../../lib/payroll/setup";

function requireOrg(orgId: string | undefined): string {
  if (!orgId) throw new Error("No organization");
  return orgId;
}

export function usePayrollEmployerSettings() {
  const { org, role } = useAuth();
  return useQuery({
    queryKey: ["payroll_employer_settings", org?.id],
    enabled: Boolean(org?.id) && isAdmin(role),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payroll_employer_settings")
        .select("*")
        .eq("org_id", org!.id)
        .order("effective_from", { ascending: false });
      if (error) throw toThrownError(error, "Could not load employer settings");
      return (data ?? []) as PayrollEmployerSettingsRow[];
    },
  });
}

export function useUpsertPayrollEmployerSettings() {
  const { org } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id?: string;
      values: Omit<PayrollEmployerSettingsRow, "id" | "org_id" | "created_at" | "updated_at">;
    }) => {
      const orgId = requireOrg(org?.id);
      const payload = { ...input.values, org_id: orgId };
      if (input.id) {
        const { error } = await supabase.from("payroll_employer_settings").update(payload).eq("id", input.id);
        if (error) throw toThrownError(error, "Could not save employer settings");
        return input.id;
      }
      const { data, error } = await supabase.from("payroll_employer_settings").insert(payload).select("id").single();
      if (error || !data) throw toThrownError(error, "Could not save employer settings");
      return data.id as string;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["payroll_employer_settings"] });
    },
  });
}

export function useDeletePayrollEmployerSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("payroll_employer_settings").delete().eq("id", id);
      if (error) throw toThrownError(error, "Could not delete employer settings");
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["payroll_employer_settings"] });
    },
  });
}

export function usePayrollEmployeeProfiles() {
  const { org, role } = useAuth();
  return useQuery({
    queryKey: ["payroll_employee_profiles", org?.id],
    enabled: Boolean(org?.id) && isAdmin(role),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payroll_employee_profiles")
        .select("*")
        .eq("org_id", org!.id);
      if (error) throw toThrownError(error, "Could not load payroll profiles");
      return (data ?? []) as PayrollEmployeeProfileRow[];
    },
  });
}

export function usePayrollPayRates() {
  const { org, role } = useAuth();
  return useQuery({
    queryKey: ["payroll_pay_rates", org?.id],
    enabled: Boolean(org?.id) && isAdmin(role),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payroll_pay_rates")
        .select("*")
        .eq("org_id", org!.id)
        .order("effective_from", { ascending: false });
      if (error) throw toThrownError(error, "Could not load pay rates");
      return (data ?? []) as PayrollPayRateRow[];
    },
  });
}

export function useSavePayrollEmployeeSetup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      employeeId: string;
      profile: PayrollEmployeeSetupProfilePayload;
      rates: PayrollPayRateSetupPayload[];
    }) => {
      const duplicate = findDuplicatePayRateError(input.rates);
      if (duplicate) throw new Error(duplicate);
      const { error } = await supabase.rpc("save_payroll_employee_setup", {
        target_employee_id: input.employeeId,
        profile: input.profile,
        rates: input.rates,
      });
      if (error) throw toThrownError(error, "Could not save payroll profile");
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["payroll_employee_profiles"] });
      void qc.invalidateQueries({ queryKey: ["payroll_pay_rates"] });
    },
  });
}

export function usePayrollOpeningBalances() {
  const { org, role } = useAuth();
  return useQuery({
    queryKey: ["payroll_opening_balances", org?.id],
    enabled: Boolean(org?.id) && isAdmin(role),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payroll_opening_balances")
        .select("*, payroll_opening_balance_taxes(*)")
        .eq("org_id", org!.id)
        .order("tax_year", { ascending: false });
      if (error) throw toThrownError(error, "Could not load opening balances");
      return (data ?? []) as PayrollOpeningBalanceWithTaxes[];
    },
  });
}

export function useImportPayrollOpeningBalances() {
  const { org } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (rows: OpeningBalanceImportRow[]) => {
      const orgId = requireOrg(org?.id);
      const { error } = await supabase.rpc("import_payroll_opening_balances", {
        target_org_id: orgId,
        balances: toOpeningBalanceImportPayloads(rows),
      });
      if (error) throw toThrownError(error, "Could not import opening balances");
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["payroll_opening_balances"] });
    },
  });
}

export function useDeletePayrollOpeningBalance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("payroll_opening_balances").delete().eq("id", id);
      if (error) throw toThrownError(error, "Could not delete opening balance");
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["payroll_opening_balances"] });
    },
  });
}

export function usePayrollCloverNames() {
  const { org, role } = useAuth();
  return useQuery({
    queryKey: ["payroll_clover_names", org?.id],
    enabled: Boolean(org?.id) && isAdmin(role),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payroll_clover_names")
        .select("*")
        .eq("org_id", org!.id)
        .order("clover_name");
      if (error) throw toThrownError(error, "Could not load Clover names");
      return (data ?? []) as PayrollCloverNameRow[];
    },
  });
}

export function useUpsertPayrollCloverName() {
  const { org } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id?: string;
      clover_name: string;
      employee_id: string | null;
      ignored: boolean;
    }) => {
      const orgId = requireOrg(org?.id);
      const payload = {
        org_id: orgId,
        clover_name: input.clover_name.trim(),
        employee_id: input.ignored ? null : input.employee_id,
        ignored: input.ignored,
      };
      if (input.id) {
        const { error } = await supabase.from("payroll_clover_names").update(payload).eq("id", input.id);
        if (error) throw toThrownError(error, "Could not save Clover name");
        return input.id;
      }
      const { data, error } = await supabase.from("payroll_clover_names").insert(payload).select("id").single();
      if (error || !data) throw toThrownError(error, "Could not save Clover name");
      return data.id as string;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["payroll_clover_names"] });
    },
  });
}

export function useDeletePayrollCloverName() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("payroll_clover_names").delete().eq("id", id);
      if (error) throw toThrownError(error, "Could not delete Clover name");
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["payroll_clover_names"] });
    },
  });
}
