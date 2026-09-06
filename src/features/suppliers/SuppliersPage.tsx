import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Table, THead, Td, Th } from "../../components/ui/table";
import type { Supplier } from "../../lib/types";
import { SupplierDialog } from "./SupplierDialog";
import { useDeleteSupplier, useSuppliers } from "./hooks";

export function SuppliersPage() {
  const { data: suppliers = [], isLoading, error } = useSuppliers();
  const remove = useDeleteSupplier();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return suppliers;
    return suppliers.filter((s) =>
      `${s.name} ${s.contact_email ?? ""} ${s.phone ?? ""}`.toLowerCase().includes(q),
    );
  }, [suppliers, search]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          className="max-w-xs"
          placeholder="Search suppliers"
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
            Add supplier
          </Button>
        </div>
      </div>

      {error ? <p className="text-sm text-danger">{error.message}</p> : null}
      {isLoading ? <p className="text-sm text-muted">Loading suppliers…</p> : null}

      {!isLoading ? (
        <Table>
          <THead>
            <tr>
              <Th>Name</Th>
              <Th>Email</Th>
              <Th>Phone</Th>
              <Th>Notes</Th>
              <Th />
            </tr>
          </THead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <Td colSpan={5} className="py-10 text-center text-muted">
                  No suppliers yet.
                </Td>
              </tr>
            ) : (
              filtered.map((supplier) => (
                <tr key={supplier.id} className="hover:bg-paper">
                  <Td className="font-medium">{supplier.name}</Td>
                  <Td>{supplier.contact_email ?? "—"}</Td>
                  <Td>{supplier.phone ?? "—"}</Td>
                  <Td className="max-w-xs truncate text-muted">{supplier.notes ?? "—"}</Td>
                  <Td>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="subtle"
                        onClick={() => {
                          setEditing(supplier);
                          setOpen(true);
                        }}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="subtle"
                        onClick={() => {
                          if (window.confirm(`Delete ${supplier.name}?`)) {
                            void remove.mutateAsync(supplier.id);
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

      <SupplierDialog open={open} onOpenChange={setOpen} supplier={editing} />
    </div>
  );
}
