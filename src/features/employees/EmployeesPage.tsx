import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../auth/auth-context";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Table, THead, Td, Th } from "../../components/ui/table";
import { formatMoney } from "../../lib/format";
import { isManager } from "../../lib/schedule";
import type { Employee } from "../../lib/types";
import { EmployeeDialog } from "./EmployeeDialog";
import { useDeleteEmployee, useEmployees } from "./hooks";

export function EmployeesPage() {
  const { role } = useAuth();
  const { data: employees = [], isLoading, error } = useEmployees();
  const remove = useDeleteEmployee();
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
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          className="max-w-xs"
          placeholder="Search roster"
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
      {isLoading ? <p className="text-sm text-mist">Loading roster…</p> : null}

      {!isLoading ? (
        <Table>
          <THead>
            <tr>
              <Th>Name</Th>
              <Th>Station</Th>
              <Th>Email</Th>
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
                <Td colSpan={8} className="py-10 text-center text-mist">
                  No employees yet.
                </Td>
              </tr>
            ) : (
              filtered.map((employee) => (
                <tr key={employee.id} className="hover:bg-paper">
                  <Td className="font-medium">{employee.full_name}</Td>
                  <Td>{employee.position}</Td>
                  <Td>{employee.email ?? "—"}</Td>
                  <Td>{employee.phone ?? "—"}</Td>
                  <Td>{formatMoney(employee.hourly_rate)}</Td>
                  <Td>
                    <Badge tone={employee.user_id ? "ok" : "neutral"}>
                      {employee.user_id ? "Linked" : "Invite pending"}
                    </Badge>
                  </Td>
                  <Td>
                    <Badge tone={employee.active ? "ok" : "warn"}>
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
