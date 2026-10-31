import { useEffect, useState, type FormEvent } from "react";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { Input, Select } from "../../components/ui/input";
import { Field } from "../../components/ui/label";
import { Table, THead, Td, Th } from "../../components/ui/table";
import type { PayrollCloverNameRow } from "../../lib/types";
import { useEmployees } from "../employees/hooks";
import { useDeletePayrollCloverName, usePayrollCloverNames, useUpsertPayrollCloverName } from "./hooks";

export function CloverNamesPanel() {
  const { data: rows = [], isLoading, error } = usePayrollCloverNames();
  const { data: employees = [] } = useEmployees();
  const remove = useDeletePayrollCloverName();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PayrollCloverNameRow | null>(null);

  const nameById = new Map(employees.filter((row) => row.active).map((row) => [row.id, row.full_name]));

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <Button
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
        >
          Add Clover name
        </Button>
      </div>
      {error ? <p className="mb-3 text-sm text-danger">{error.message}</p> : null}
      {isLoading ? <p className="text-sm text-muted">Loading Clover names…</p> : null}
      {!isLoading ? (
        <Table>
          <THead>
            <tr>
              <Th>Clover name</Th>
              <Th>Mapped employee</Th>
              <Th>Status</Th>
              <Th />
            </tr>
          </THead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <Td colSpan={4} className="py-10 text-center text-muted">
                  No Clover names yet.
                </Td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id}>
                  <Td className="font-medium">{row.clover_name}</Td>
                  <Td>{row.employee_id ? (nameById.get(row.employee_id) ?? row.employee_id) : "—"}</Td>
                  <Td>
                    <Badge tone={row.ignored ? "neutral" : "ok"}>{row.ignored ? "Ignored" : "Mapped"}</Badge>
                  </Td>
                  <Td>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="subtle"
                        onClick={() => {
                          setEditing(row);
                          setOpen(true);
                        }}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="subtle"
                        onClick={() => {
                          if (window.confirm(`Remove ${row.clover_name}?`)) {
                            void remove.mutateAsync(row.id);
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
      <CloverNameDialog
        open={open}
        onOpenChange={setOpen}
        row={editing}
        employees={employees.filter((row) => row.active)}
      />
    </div>
  );
}

function CloverNameDialog({
  open,
  onOpenChange,
  row,
  employees,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: PayrollCloverNameRow | null;
  employees: Array<{ id: string; full_name: string }>;
}) {
  const upsert = useUpsertPayrollCloverName();
  const [cloverName, setCloverName] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [ignored, setIgnored] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setCloverName(row?.clover_name ?? "");
    setEmployeeId(row?.employee_id ?? "");
    setIgnored(row?.ignored ?? false);
    setFormError(null);
  }, [open, row]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    if (!cloverName.trim()) {
      setFormError("Clover name is required");
      return;
    }
    if (!ignored && !employeeId) {
      setFormError("Map the name to an employee or mark it ignored");
      return;
    }
    try {
      await upsert.mutateAsync({
        id: row?.id,
        clover_name: cloverName,
        employee_id: ignored ? null : employeeId,
        ignored,
      });
      onOpenChange(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not save Clover name");
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={row ? "Edit Clover name" : "Add Clover name"}
      description="A name is either mapped to one employee or ignored. Training tills belong on ignore."
    >
      <form id="clover-name-form" className="grid gap-3" onSubmit={(e) => void onSubmit(e)}>
        <Field label="Clover name" htmlFor="clover-name">
          <Input
            id="clover-name"
            required
            value={cloverName}
            onChange={(e) => setCloverName(e.target.value)}
          />
        </Field>
        <Field label="Employee" htmlFor="clover-employee">
          <Select
            id="clover-employee"
            disabled={ignored}
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
          >
            <option value="">Select employee</option>
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.full_name}
              </option>
            ))}
          </Select>
        </Field>
        <label className="flex items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            checked={ignored}
            onChange={(e) => {
              setIgnored(e.target.checked);
              if (e.target.checked) setEmployeeId("");
            }}
          />
          Ignore this name
        </label>
      </form>
      {formError ? <p className="mt-3 text-sm text-danger">{formError}</p> : null}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button type="submit" form="clover-name-form" disabled={upsert.isPending}>
          {upsert.isPending ? "Saving…" : "Save name"}
        </Button>
      </div>
    </Dialog>
  );
}
