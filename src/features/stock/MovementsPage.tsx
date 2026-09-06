import { useMemo, useState } from "react";
import { Badge } from "../../components/ui/badge";
import { Input, Select } from "../../components/ui/input";
import { Table, THead, Td, Th } from "../../components/ui/table";
import { MOVEMENT_REASONS } from "../../lib/constants";
import { formatDateTime, formatQty } from "../../lib/format";
import { reasonLabel } from "../../lib/inventory";
import type { MovementReason } from "../../lib/types";
import { useStockMovements } from "./hooks";

function toneFor(reason: MovementReason) {
  switch (reason) {
    case "purchase":
      return "ok" as const;
    case "usage":
      return "neutral" as const;
    case "adjustment":
      return "warn" as const;
    case "waste":
      return "danger" as const;
    default: {
      const exhaustive: never = reason;
      return exhaustive;
    }
  }
}

export function MovementsPage() {
  const { data: movements = [], isLoading, error } = useStockMovements();
  const [search, setSearch] = useState("");
  const [reason, setReason] = useState<"" | MovementReason>("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return movements.filter((m) => {
      if (reason && m.reason !== reason) return false;
      if (!q) return true;
      const name = m.inventory_items?.name ?? "";
      const sku = m.inventory_items?.sku ?? "";
      return `${name} ${sku} ${m.note ?? ""}`.toLowerCase().includes(q);
    });
  }, [movements, search, reason]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          className="max-w-xs"
          placeholder="Search item or note"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select
          className="w-44"
          value={reason}
          onChange={(e) => setReason(e.target.value as "" | MovementReason)}
        >
          <option value="">All reasons</option>
          {MOVEMENT_REASONS.map((r) => (
            <option key={r} value={r}>
              {reasonLabel(r)}
            </option>
          ))}
        </Select>
      </div>

      {error ? <p className="text-sm text-danger">{error.message}</p> : null}
      {isLoading ? <p className="text-sm text-mist">Loading movements…</p> : null}

      {!isLoading ? (
        <Table>
          <THead>
            <tr>
              <Th>When</Th>
              <Th>Item</Th>
              <Th>Reason</Th>
              <Th>Delta</Th>
              <Th>Note</Th>
            </tr>
          </THead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <Td colSpan={5} className="py-10 text-center text-mist">
                  No movements yet.
                </Td>
              </tr>
            ) : (
              filtered.map((m) => (
                <tr key={m.id} className="hover:bg-paper">
                  <Td className="whitespace-nowrap text-mist">{formatDateTime(m.created_at)}</Td>
                  <Td>
                    <div className="font-medium">{m.inventory_items?.name ?? "Deleted item"}</div>
                    <div className="text-xs text-mist">{m.inventory_items?.sku ?? ""}</div>
                  </Td>
                  <Td>
                    <Badge tone={toneFor(m.reason)}>{reasonLabel(m.reason)}</Badge>
                  </Td>
                  <Td className={Number(m.delta) < 0 ? "text-danger" : "text-ok"}>
                    {Number(m.delta) > 0 ? "+" : ""}
                    {formatQty(m.delta)} {m.inventory_items?.unit ?? ""}
                  </Td>
                  <Td className="text-mist">{m.note ?? "—"}</Td>
                </tr>
              ))
            )}
          </tbody>
        </Table>
      ) : null}
    </div>
  );
}
