import { useState } from "react";
import { useAuth } from "../../auth/auth-context";
import { PageTabs } from "../../components/ui/page-tabs";
import { isAdmin } from "../../lib/schedule";
import { CloverNamesPanel } from "./CloverNamesPanel";
import { EmployeesPanel } from "./EmployeesPanel";
import { EmployerSettingsPanel } from "./EmployerSettingsPanel";
import { OpeningBalancesPanel } from "./OpeningBalancesPanel";

type SetupTab = "employer" | "employees" | "balances" | "clover";

export function PayrollSetupPage() {
  const { role } = useAuth();
  const [tab, setTab] = useState<SetupTab>("employer");

  if (!isAdmin(role)) {
    return (
      <p className="text-sm text-muted">
        Payroll setup is limited to admins. Pay rates, withholding, and opening balances stay hidden from
        managers and staff.
      </p>
    );
  }

  return (
    <div>
      <p className="mb-4 max-w-3xl text-sm text-muted">
        Employer tax settings, employee withholding, opening year-to-date, and Clover name maps for the
        Puerto Rico payroll engine. Dollar amounts are stored as integer cents.
      </p>
      <div className="mb-4">
        <PageTabs
          items={[
            { id: "employer", label: "Employer settings" },
            { id: "employees", label: "Employees" },
            { id: "balances", label: "Opening balances" },
            { id: "clover", label: "Clover names" },
          ]}
          value={tab}
          onChange={setTab}
        />
      </div>
      {tab === "employer" ? <EmployerSettingsPanel /> : null}
      {tab === "employees" ? <EmployeesPanel /> : null}
      {tab === "balances" ? <OpeningBalancesPanel /> : null}
      {tab === "clover" ? <CloverNamesPanel /> : null}
    </div>
  );
}
