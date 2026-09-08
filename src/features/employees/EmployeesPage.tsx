import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../auth/auth-context";
import { Avatar } from "../../components/ui/avatar";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { SearchInput } from "../../components/ui/search-input";
import { Table, THead, Td, Th } from "../../components/ui/table";
import { formatMoney } from "../../lib/format";
import { isManager } from "../../lib/schedule";
import type { Employee } from "../../lib/types";
import { EmployeeDialog } from "./EmployeeDialog";
import { useDeleteEmployee, useEmployees, useRotateInvite } from "./hooks";

export function EmployeesPage() {
  const { role } = useAuth();
  const { data: employees = [], isLoading, error } = useEmployees();
  const remove = useDeleteEmployee();
  const rotateInvite = useRotateInvite();
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

  if (!isManager(role)) {
    return <Navigate to="/schedule" replace />;
  }

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <SearchInput
          placeholder="Search roster…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="ml-auto">
          <Button
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            <Plus className="size-4" />
            Add employee
          </Button>
        </div>
      </div>

      {error ? <p className="text-sm text-danger">{error.message}</p> : null}
      {isLoading ? <p className="text-sm text-muted">Loading roster…</p> : null}

      {!isLoading ? (
        <Table>
          <THead>
            <tr>
              <Th>Name</Th>
              <Th>Position</Th>
              <Th>Phone</Th>
              <Th>Rate</Th>
              <Th>Login</Th>
              <Th>Invite</Th>
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
              filtered.map((employee) => (
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
                  <Td>{employee.phone ?? "—"}</Td>
                  <Td>{formatMoney(employee.hourly_rate)}</Td>
                  <Td>
                    <Badge tone={employee.user_id ? "ok" : "neutral"} dot>
                      {employee.user_id ? "Linked" : "Invite pending"}
                    </Badge>
                  </Td>
                  <Td>
                    {employee.user_id ? (
                      <span className="text-muted">—</span>
                    ) : employee.invite_code ? (
                      <div className="flex items-center gap-1">
                        <code className="rounded bg-paper px-1.5 py-0.5 text-[11px]">
                          {employee.invite_code}
                        </code>
                        <Button
                          variant="subtle"
                          onClick={() => {
                            void navigator.clipboard.writeText(employee.invite_code ?? "");
                          }}
                        >
                          Copy
                        </Button>
                        <Button
                          variant="subtle"
                          onClick={() => {
                            void rotateInvite.mutateAsync(employee.id);
                          }}
                        >
                          Rotate
                        </Button>
                      </div>
                    ) : (
                      <span className="text-xs text-muted">Add an email</span>
                    )}
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
              ))
            )}
          </tbody>
        </Table>
      ) : null}

      <EmployeeDialog open={open} onOpenChange={setOpen} employee={editing} />
    </div>
  );
}
