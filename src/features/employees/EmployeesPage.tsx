import { Plus } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../auth/auth-context";
import { Avatar } from "../../components/ui/avatar";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { SearchInput } from "../../components/ui/search-input";
import { Table, THead, Td, Th } from "../../components/ui/table";
import { canSendInvite, loginState, type LoginState } from "../../lib/employee-invite";
import { formatMoney } from "../../lib/format";
import { groupEmployeesByRestaurant, isAdmin } from "../../lib/schedule";
import type { Employee } from "../../lib/types";
import { useRestaurants } from "../invoices/hooks";
import { EmployeeDialog } from "./EmployeeDialog";
import { useDeleteEmployee, useEmployeeLogins, useEmployees, useSendInvite } from "./hooks";

const LOGIN_LABELS: Record<LoginState, { label: string; tone: "ok" | "info" | "neutral" }> = {
  linked: { label: "Active login", tone: "ok" },
  invited: { label: "Invite sent", tone: "info" },
  "not-invited": { label: "No login", tone: "neutral" },
  "no-email": { label: "No email", tone: "neutral" },
  inactive: { label: "No login", tone: "neutral" },
};

function LoginCell({
  employee,
  state,
  sending,
  busy,
  onSend,
}: {
  employee: Employee;
  state: LoginState;
  sending: boolean;
  busy: boolean;
  onSend: () => void;
}) {
  const { label, tone } = LOGIN_LABELS[state];
  return (
    <div className="flex items-center gap-1">
      <Badge tone={tone} dot>
        {label}
      </Badge>
      {canSendInvite(employee, state) ? (
        <Button variant="subtle" disabled={busy} onClick={onSend}>
          {sending ? "Sending…" : state === "invited" ? "Resend" : "Send invite"}
        </Button>
      ) : null}
    </div>
  );
}

export function EmployeesPage() {
  const { role } = useAuth();
  const { data: employees = [], isLoading, error } = useEmployees();
  const remove = useDeleteEmployee();
  const { data: restaurants = [] } = useRestaurants();
  const { data: logins } = useEmployeeLogins();
  const sendInvite = useSendInvite();
  const [inviteNotice, setInviteNotice] = useState<{ ok: boolean; message: string } | null>(null);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter((e) =>
      `${e.full_name} ${e.email ?? ""} ${e.position}`.toLowerCase().includes(q),
    );
  }, [employees, search]);
  const groups = useMemo(() => groupEmployeesByRestaurant(filtered, restaurants), [filtered, restaurants]);

  if (!isAdmin(role)) {
    return <Navigate to="/schedule" replace />;
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2 md:flex-nowrap">
        <SearchInput
          placeholder="Search roster…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="min-w-0 flex-1 md:flex-none"
        />
        <div className="ml-auto w-full sm:w-auto">
          <Button
            className="w-full sm:w-auto"
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            <Plus className="size-4" />
            Add account
          </Button>
        </div>
      </div>

      {error ? <p className="text-sm text-danger">{error.message}</p> : null}
      {inviteNotice ? (
        <p className={`mb-3 text-sm ${inviteNotice.ok ? "text-ok" : "text-danger"}`} role="status">
          {inviteNotice.message}
        </p>
      ) : null}
      {isLoading ? <p className="text-sm text-muted">Loading roster…</p> : null}

      {!isLoading ? (
        <Table>
          <THead>
            <tr>
              <Th>Name</Th>
              <Th>Station</Th>
              <Th>Access</Th>
              <Th>Phone</Th>
              <Th>Rate</Th>
              <Th>Login</Th>
              <Th>Status</Th>
              <Th />
            </tr>
          </THead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <Td colSpan={8} className="py-10 text-center text-muted">
                  No employees yet.
                </Td>
              </tr>
            ) : (
              groups.map((group) => (
                <Fragment key={group.restaurant?.id ?? "none"}>
                  <tr>
                    <Td colSpan={8} className="bg-paper text-xs font-medium uppercase tracking-wide text-ink">
                      {group.restaurant?.name ?? "No restaurant"} · {group.employees.length}
                    </Td>
                  </tr>
                  {group.employees.map((employee) => (
                    <tr key={employee.id} className="hover:bg-paper">
                      <Td>
                        <div className="flex items-center gap-3">
                          <Avatar name={employee.full_name} />
                          <div>
                            <div className="font-medium">{employee.full_name}</div>
                            <div className="text-xs text-muted">{employee.email ?? "No email"}</div>
                          </div>
                        </div>
                      </Td>
                      <Td>{employee.position}</Td>
                      <Td>{employee.login_role === "manager" ? "Manager" : "Staff"}</Td>
                      <Td>{employee.phone ?? "—"}</Td>
                      <Td>{formatMoney(employee.hourly_rate)}</Td>
                      <Td>
                        <LoginCell
                          employee={employee}
                          state={loginState(employee, logins?.get(employee.id))}
                          sending={sendInvite.isPending && sendInvite.variables === employee.id}
                          busy={sendInvite.isPending}
                          onSend={() => {
                            setInviteNotice(null);
                            sendInvite.mutate(employee.id, {
                              onSuccess: (status) =>
                                setInviteNotice({
                                  ok: true,
                                  message: `${status === "resent" ? "Invite sent again" : "Invite sent"} to ${employee.email}.`,
                                }),
                              onError: (err) =>
                                setInviteNotice({
                                  ok: false,
                                  message: `${employee.full_name}: ${err instanceof Error ? err.message : "Could not send the invite"}`,
                                }),
                            });
                          }}
                        />
                      </Td>
                      <Td>
                        <Badge tone={employee.active ? "ok" : "neutral"} dot>
                          {employee.active ? "Active" : "Inactive"}
                        </Badge>
                      </Td>
                      <Td>
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="subtle"
                            onClick={() => {
                              setEditing(employee);
                              setOpen(true);
                            }}
                          >
                            Edit
                          </Button>
                          <Button
                            variant="subtle"
                            onClick={() => {
                              if (window.confirm(`Remove ${employee.full_name} from the roster?`)) {
                                void remove.mutateAsync(employee.id);
                              }
                            }}
                          >
                            Delete
                          </Button>
                        </div>
                      </Td>
                    </tr>
                  ))}
                </Fragment>
              ))
            )}
          </tbody>
        </Table>
      ) : null}

      <EmployeeDialog open={open} onOpenChange={setOpen} employee={editing} />
    </div>
  );
}
